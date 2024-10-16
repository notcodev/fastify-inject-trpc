import {
  AnyProcedure,
  AnyRouter,
  ProcedureArgs,
  ProcedureRouterRecord,
  ProcedureType,
} from '@trpc/server'
import { createRecursiveProxy } from '@trpc/server/shared'
import { InjectOptions, LightMyRequestResponse } from 'fastify'
import fp from 'fastify-plugin'
import querystring from 'node:querystring'

export interface DecoratedProcedure<TProcedure extends AnyProcedure> {
  (input: ProcedureArgs<TProcedure['_def']>[0]): InjectConfig<TProcedure>
}

export type DecoratedProcedureRecord<
  TProcedures extends ProcedureRouterRecord,
> = {
  [TKey in keyof TProcedures]: TProcedures[TKey] extends AnyRouter
    ? DecoratedProcedureRecord<TProcedures[TKey]['_def']['record']>
    : TProcedures[TKey] extends AnyProcedure
      ? TProcedures[TKey]['_type'] extends 'subscription'
        ? { error: 'Subscriptions is currently unsupported' }
        : DecoratedProcedure<TProcedures[TKey]>
      : never
}

// Generic here is used to infer output response type
// eslint-disable-next-line @typescript-eslint/naming-convention
export type InjectConfig<_T extends AnyProcedure> = {
  url: string
  headers?: { 'content-type': string }
} & ({ method: 'GET'; query: string } | { body: string; method: 'POST' })

export type ProcedureOutput<TProcedure extends AnyProcedure> =
  TProcedure['_def']['_output_out']

interface InjectConfigGetter<
  TRouter extends AnyRouter,
  TProcedure extends AnyProcedure,
> {
  (
    proxy: DecoratedProcedureRecord<TRouter['_def']['record']>,
  ): InjectConfig<TProcedure>
}

export type TRPCInjectOptions = Omit<
  InjectOptions,
  'path' | 'url' | 'query' | 'method' | 'payload' | 'body'
>

export interface TRPCSuccessfullPayload<TProcedure extends AnyProcedure> {
  result: ProcedureOutput<TProcedure> extends void
    ? Record<string, never>
    : { data: ProcedureOutput<TProcedure> }
}

export interface TRPCErrorPayload {
  error: {
    message: string
    code: number
    data: {
      code: string
      httpStatus: number
      stack: string
      path: string
    }
  }
}

export type TRPCInjectorResponse<TProcedure extends AnyProcedure> = Omit<
  LightMyRequestResponse,
  'json'
> & {
  json: () => TRPCSuccessfullPayload<TProcedure> | TRPCErrorPayload
}

export interface TRPCInjectorRequestCallback<TProcedure extends AnyProcedure> {
  (
    error: Error | undefined,
    response: TRPCInjectorResponse<TProcedure> | undefined,
  ): void
}

export interface FastiyfyTRPCInjector<TRouter extends AnyRouter> {
  <TProcedure extends AnyProcedure>(
    getInjectConfig: InjectConfigGetter<TRouter, TProcedure>,
    options?: TRPCInjectOptions,
  ): Promise<TRPCInjectorResponse<TProcedure>>
  <TProcedure extends AnyProcedure>(
    getInjectConfig: InjectConfigGetter<TRouter, TProcedure>,
    callback: TRPCInjectorRequestCallback<TProcedure>,
  ): void
  <TProcedure extends AnyProcedure>(
    getInjectConfig: InjectConfigGetter<TRouter, TProcedure>,
    options: TRPCInjectOptions,
    callback: TRPCInjectorRequestCallback<TProcedure>,
  ): void
}

declare module 'fastify' {
  interface FastifyInstance {
    injectTRPC: FastiyfyTRPCInjector<AnyRouter>
    withTypedTRPCInjector: <TRouter extends AnyRouter>() => Omit<
      FastifyInstance,
      'injectTRPC'
    > & {
      injectTRPC: FastiyfyTRPCInjector<TRouter>
    }
  }
}

export interface FastifyTRPCInjectorPluginOptions {
  router: AnyRouter
  prefix: `/${string}`
}

export const fastifyTRPCInjectorPlugin = fp(
  (fastify, { prefix, router }: FastifyTRPCInjectorPluginOptions, done) => {
    const def = router._def

    fastify.decorate(
      'injectTRPC',
      (
        getInjectConfig,
        callbackOrOptions?:
          | TRPCInjectOptions
          | TRPCInjectorRequestCallback<AnyProcedure>,
        callback?: TRPCInjectorRequestCallback<AnyProcedure>,
      ): Promise<TRPCInjectorResponse<AnyProcedure>> | void => {
        const injectConfig = getInjectConfig(
          createRecursiveProxy(
            ({ path, args }): InjectConfig<AnyProcedure> => {
              const fullPath = path.join('.')
              const procedure = def.procedures[fullPath] as AnyProcedure
              const url = prefix + '/' + fullPath

              let type: ProcedureType = 'query'
              if (procedure._def.mutation) {
                type = 'mutation'
              } else if (procedure._def.subscription) {
                type = 'subscription'
              }

              switch (type) {
                case 'query':
                  return {
                    url,
                    query: querystring.stringify({
                      input: JSON.stringify(args[0]), // TODO: Add superjson support
                    }),
                    method: 'GET',
                  }
                case 'mutation':
                  return {
                    url,
                    body: JSON.stringify(args[0]), // TODO: Add superjson support
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                  }
                case 'subscription':
                  break
                default:
              }

              return null!
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ) as any,
        )
        let injectOptions: InjectOptions = injectConfig

        const inject = (
          options: InjectOptions,
          callback?: TRPCInjectorRequestCallback<AnyProcedure>,
        ): Promise<TRPCInjectorResponse<AnyProcedure>> | void => {
          function modifyResponse(response: LightMyRequestResponse) {
            return {
              ...response,
              json() {
                return JSON.parse(this.body)
              },
            }
          }

          if (callback) {
            return fastify.inject(
              options,
              (
                error: Error | undefined,
                response: LightMyRequestResponse | undefined,
              ) => {
                const modifiedResponse = response
                  ? modifyResponse(response)
                  : undefined

                callback(error, modifiedResponse)
              },
            )
          }

          return fastify.inject(options).then(modifyResponse)
        }

        if (callbackOrOptions && typeof callbackOrOptions === 'object') {
          injectOptions = {
            ...injectOptions,
            ...callbackOrOptions,
            headers: {
              ...(injectOptions.headers || {}),
              ...(callbackOrOptions.headers || {}),
            },
          }

          return inject(injectOptions, callback)
        }

        return inject(injectOptions, callbackOrOptions)
      },
    )
    fastify.decorate('withTypedTRPCInjector', () => fastify)

    done()
  },
  {
    fastify: '5.x',
    name: 'fastify-inject-trpc',
    decorators: { fastify: ['injectTRPC', 'withTypedTRPCInjector'] },
  },
)
