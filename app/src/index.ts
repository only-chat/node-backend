import { WebSocketServer } from 'ws';
import { appId, storeConfig, userStoreConfig, host, port, queueConfig, wsPingInterval } from '../config.js';
import { initialize as initializeQueue } from '@only-chat/rabbitmq-queue';
import { initialize as initializeStore, saveInstance } from '@only-chat/elasticsearch-store';
import { initialize as initializeUserStore } from '@only-chat/elasticsearch-user-store';
import { initialize as initializeClient, WsClient } from '@only-chat/client';

import type { AddressInfo } from 'ws';
import type { Log } from '@only-chat/types/log.js';

const logger: Log = console;

logger.debug('Application started');

const queue = await initializeQueue(queueConfig);

const store = await initializeStore(storeConfig);

const userStore = await initializeUserStore(userStoreConfig);

const { _id: instanceId } = await saveInstance(appId);

logger.debug('Instance id:', instanceId);

initializeClient({ queue, store, userStore, instanceId }, logger);

const ws = new WebSocketServer({ host, port });

logger.debug('WebSocketServer created');

ws.on('error', e => logger.error('WebSocketServer error:', e));

ws.on('connection', s => new WsClient(s));

ws.on('listening', () => {
    const { address, port } = ws.address() as AddressInfo;
    logger.debug('Server listening on %s:%d', address, port);
});

const _ = setInterval(() => ws.clients.forEach(s => s.ping()), wsPingInterval);