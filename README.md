# 💉 Fastify inject tRPC

Plugin for Fastify that allows to use the Fastify inject API with the full power of tRPC types

## Installation

Install with [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/) or [pnpm](https://pnpm.io)

```shell
npm install fastify-inject-trpc
# or
yarn add fastify-inject-trpc
# or
pnpm add fastify-inject-trpc
```

## Features

- Allows to inject tRPC procedures calls with fastify inject API
- Fully type safe procedures calls
- Very similar API to Fastify's inject

## Limitations

- Subscriptions are not supported at this time
- Custom serializers are not supported at this time

## Usage

```ts
import fastify from 'fastify'
import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import {
  fastifyTRPCPlugin,
  FastifyTRPCPluginOptions,
} from '@trpc/server/adapters/fastify'
import { fastifyInjectTRPCPlugin } from 'fastify-inject-trpc'

// 1. Init TRPC
const t = initTRPC.create()

// 2. Create router
const appRouter = t.router({
  greeting: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ input: { name } }) => {
      return `Hello, ${name}!`
    }),
})

type AppRouter = typeof appRouter

// 3. Create Fastify builder
async function buildFastify() {
  // 3.1. Create Fastify instance
  const app = fastify()

  // 3.2. Register fastifyTRPCPlugin
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
    },
  })

  // 3.3. Register fastifyTRPCInjectorPlugin and await it (https://fastify.dev/docs/latest/Reference/Plugins/#asyncawait)
  await app.regester(fastifyTRPCInjectorPlugin, {
    router: appRouter,
    prefix: '/trpc',
  })

  return app.withTypedTRPCInjector<AppRouter>()
}

const app = await buildFastify()

// 4. Inject a tRPC procedure call
const response = await app.injectTRPC((router) =>
  router.greeting({ name: 'World' }),
)
const json = response.json()

// Before using it you should check that response didn't return any error
if ('result' in json) {
  const greetingStr = json.result.data
  // ^?
  // Type of greetingStr would be a string
}
```
