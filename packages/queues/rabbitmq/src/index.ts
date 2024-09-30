import amqp from 'amqplib';

import type { Message, MessageQueue, MessageType } from '@only-chat/types/queue.js';

export type { Options } from 'amqplib';

export interface Config {
    url: string | amqp.Options.Connect;
    exchange?: string;
    exchangeType?: string;
    exchangeOptions?: amqp.Options.AssertExchange;
    routingKey?: string;
    queue?: string;
    queueOptions?: amqp.Options.AssertQueue;
}

const acceptTypes: MessageType[] = ['connected', 'disconnected', 'joined', 'left', 'closed', 'deleted', 'updated', 'message-updated', 'message-deleted', 'text', 'file'];

export async function initialize(config: Config): Promise<MessageQueue> {
    const c = await amqp.connect(config.url);

    const channel = await c.createChannel();

    const q = await channel.assertQueue(config.queue ?? '', config.queueOptions);

    if (config.exchange) {
        const e = await channel.assertExchange(config.exchange, config.exchangeType ?? 'fanout', config.exchangeOptions);

        const _ = await channel.bindQueue(q.queue, e.exchange, config.routingKey ?? '');
    }

    const subscribers: ((msg: Message) => Promise<void>)[] = [];

    const _ = channel.consume(q.queue, async function (msg) {
        if (!msg) {
            return;
        }

        const deserialized = JSON.parse(msg.content.toString());

        const type = deserialized.type?.toString();

        if (!acceptTypes.includes(type)) {
            return;
        }

        const m: Message = {
            type,
            id: deserialized.id?.toString(),
            clientMessageId: deserialized.id?.toString(),
            instanceId: deserialized.instanceId?.toString(),
            conversationId: deserialized.conversationId?.toString(),
            participants: Array.isArray(deserialized.participants) ? deserialized.participants : undefined,
            fromConnectionId: deserialized.fromConnectionId?.toString(),
            fromId: deserialized.fromId?.toString(),
            data: typeof deserialized.data === 'object' ? deserialized.data : null,
            createdAt: new Date(deserialized.createdAt),
            updatedAt: deserialized.updatedAt ? new Date(deserialized.updatedAt) : undefined,
            deletedAt: deserialized.deletedAt ? new Date(deserialized.deletedAt) : undefined,
        };

        await Promise.all(subscribers.map(c => c(m)));

        channel.ack(msg);
    });

    return {
        acceptTypes,

        async publish(msg) {
            return acceptTypes.includes(msg.type) && channel.sendToQueue(q.queue, Buffer.from(JSON.stringify(msg)));
        },

        async subscribe(callback) {
            return !!subscribers.push(callback);
        },

        async unsubscribe(callback) {
            const index = subscribers.lastIndexOf(callback);
            if (index < 0) {
                return false;
            }

            return !!subscribers.splice(index, 1);
        },
    };
}