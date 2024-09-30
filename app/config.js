export const storeConfig = {
    options: {
        node: 'https://localhost:9200',
        auth: {
            username: 'elastic',
            password: '3U7fUJ4UoouAGYrGgWO4',
            //password:'s-4kz-hN4mmHHd_FHMsD',
        },
        tls: {
            rejectUnauthorized: false,
        }
    },
    connectionsIndex: 'only-chat-connections',
    conversationsIndex: 'only-chat-conversations',
    instancesIndex: 'only-chat-instances',
    messagesIndex: 'only-chat-messages',
    peerToPeerConversationsIndex: 'only-chat-user-user-conversations',
}

export const userStoreConfig = {
    options: {
        node: 'https://localhost:9200',
        auth: {
            username: 'elastic',
            password: '3U7fUJ4UoouAGYrGgWO4',
            //password:'s-4kz-hN4mmHHd_FHMsD',
        },
        tls: {
            rejectUnauthorized: false,
        }
    },
    usersIndex: 'only-chat-users',
}

export const queueConfig = {
    url: 'amqp://localhost',
    exchange: 'only-chat-exchange',
    exchangeOptions: {
        durable: false,
        autoDelete: true,
    },
    queueOptions: {
        durable: false,
        exclusive: true,
        autoDelete: true,
        arguments: {
            'x-message-ttl': 60000,
        },
    },
}

export const appId = 'only-chat-node-js';

export const host = 'localhost';

export const port = 9000;

export const wsPingInterval = 30000;

export const watchConversationId = '@watch';