import type { Message, MessageQueue, MessageType } from '@only-chat/types/queue.js';

const acceptTypes = new Set<MessageType>(['connected', 'disconnected', 'joined', 'left', 'closed', 'deleted', 'updated', 'message-updated', 'message-deleted', 'text', 'file']);

export async function initialize(): Promise<MessageQueue> {
    const subscribers: ((msg: Message) => Promise<void>)[] = [];

    return {
        acceptTypes: [...acceptTypes],

        async publish(msg) {
            if (!acceptTypes.has(msg.type)) {
                return false;
            }

            subscribers.forEach(s => s(msg));
            return true;
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