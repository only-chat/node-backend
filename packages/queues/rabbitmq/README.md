# only-chat
This is a RabbitMQ queue implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/rabbitmq-queue
```

```typescript
import { initialize as initializeQueue } from '@only-chat/rabbitmq-queue'
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const queue = await initializeQueue(queueConfig)

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```