import { Client, ClientOptions } from '@elastic/elasticsearch';

import type { estypes } from '@elastic/elasticsearch';
import type { Conversation, ConversationLastMessages, ConversationsResult, FindRequest, FindResult, Message, MessageStore, MessageType, SaveResponse } from '@only-chat/types/store.js';

export type { ClientOptions } from '@elastic/elasticsearch';

export interface Config {
    options: ClientOptions;
    connectionsIndex: string;
    conversationsIndex: string;
    instancesIndex: string;
    messagesIndex: string;
    peerToPeerConversationsIndex: string;
}

interface PeerToPeerConversation {
    id: string;
    conversationId: string;
}

interface ConversationsTypeBucket extends estypes.AggregationsStringTermsBucketKeys {
    timestamp_agg: estypes.AggregationsMaxAggregate;
}

interface ConversationsTimestampBucket extends estypes.AggregationsStringTermsBucketKeys {
    type_agg: estypes.AggregationsMultiBucketAggregateBase<ConversationsTypeBucket>;
}

interface ConversationsTimestampAggregation {
    conversation_timestamp_agg: estypes.AggregationsMultiBucketAggregateBase<ConversationsTimestampBucket>;
}

interface AggregationsTotalCountValueAggregate {
    total_count: estypes.AggregationsValueCountAggregate;
}

interface AggregationsConversationIdTermAggregate {
    conversation_id_agg: estypes.AggregationsMultiBucketAggregateBase<estypes.AggregationsMultiTermsBucketKeys>;
}

let client: Client = undefined!;
let connectionsIndex: string = undefined!;
let conversationsIndex: string = undefined!;
let instancesIndex: string = undefined!;
let messagesIndex: string = undefined!;
let peerToPeerConversationsIndex: string = undefined!;

async function findMessages(r: FindRequest): Promise<FindResult> {
    const must_not: estypes.QueryDslQueryContainer[] = [{
        exists: {
            field: 'deletedAt'
        }
    }];

    if (r.excludeIds?.length) {
        must_not.push({
            ids: {
                values: r.excludeIds,
            }
        });
    }

    const must: estypes.QueryDslQueryContainer[] = [];

    if (r.ids?.length) {
        must.push({
            ids: {
                values: r.ids,
            }
        });
    }

    if (r.conversationIds?.length) {
        must.push({
            terms: {
                conversationId: r.conversationIds,
            }
        });
    }

    if (r.text) {
        must.push({
            match: {
                'data.text': {
                    query: r.text,
                }
            }
        });
    }

    if (r.fromIds?.length) {
        must.push({
            terms: {
                fromId: r.fromIds,
            }
        });
    }

    if (r.types?.length) {
        must.push({
            terms: {
                type: r.types,
            }
        });
    }

    if (r.clientMessageIds?.length) {
        must.push({
            terms: {
                clientMessageId: r.clientMessageIds,
            }
        });
    }

    const filter: estypes.QueryDslQueryContainer[] = [];

    if (r.createdFrom) {
        filter.push({ range: { createdAt: { gte: r.createdFrom.valueOf() } } });
    }

    if (r.createdTo) {
        filter.push({ range: { createdAt: { lte: r.createdTo.valueOf() } } });
    }

    const query: estypes.QueryDslQueryContainer = {
        bool: {
            must,
            must_not,
            filter,
        }
    };

    const sort: estypes.Sort = [];

    if (r.sort) {
        const sortOrder = r.sortDesc ? 'desc' : 'asc';
        sort.push({ [r.sort]: sortOrder });
    }

    if (r.size !== 0 && !r.size || r.size < 0) {
        r.size = 100;
    }

    if (!r.from || r.from < 0) {
        r.from = 0;
    }

    const result: estypes.SearchResponseBody<Message, AggregationsTotalCountValueAggregate> = await client.search({
        index: messagesIndex,
        from: r.from,
        size: r.size,
        sort,
        query,
        aggs: {
            total_count: { value_count: { field: '_id' } }
        }
    });

    return {
        messages: result.hits.hits.map(h => ({ ...h._source, id: h._id })) as Message[],
        from: r.from,
        size: r.size,
        total: result.aggregations?.total_count.value || result.hits.hits.length,
    };
}

const getConversationById = getParticipantConversationById.bind(this, undefined);

async function getLastMessagesTimestamps(fromId: string, conversationId: string[]): Promise<ConversationLastMessages> {
    const aggs: Record<string, estypes.AggregationsAggregationContainer> = {
        conversation_timestamp_agg:
        {
            aggs:
            {
                type_agg:
                {
                    aggs: { timestamp_agg: { max: { field: 'createdAt' } } },
                    terms: { field: 'type' }
                }
            },
            terms: {
                field: 'conversationId',
                size: conversationId.length,
            }
        }
    };

    const types: MessageType[] = ['file', 'text'];

    const query: estypes.QueryDslQueryContainer = {
        bool:
        {
            must_not: [{ exists: { field: 'deletedAt' } }],
            must: [
                { terms: { conversationId } },
                {
                    bool: {
                        should: [
                            { terms: { types } },
                            { term: { fromId: { value: fromId } } },
                        ],
                    },
                },
            ],
        }
    }

    const result: estypes.SearchResponseBody<Message, ConversationsTimestampAggregation> = await client.search({
        index: messagesIndex,
        size: 0,
        aggs,
        query,
    });

    const buckets = result.aggregations?.conversation_timestamp_agg.buckets as ConversationsTimestampBucket[];

    const should: estypes.QueryDslQueryContainer[] = [];

    for (const b of buckets) {
        if (b.key) {
            const type_buckets = b.type_agg.buckets as (ConversationsTypeBucket)[];
            for (const tb of type_buckets) {
                if (tb.key && tb.timestamp_agg?.value) {
                    should.push({
                        bool: {
                            must: [
                                { term: { conversationId: { value: b.key } } },
                                { term: { type: { value: tb.key } } },
                                { term: { createdAt: { value: tb.timestamp_agg.value } } },
                            ]
                        }
                    });
                }
            }
        }
    }

    const resultLastMessages: estypes.SearchResponseBody<Message> = await client.search({
        index: messagesIndex,
        size: conversationId.length * 10,
        query: {
            bool: {
                must_not: [{ exists: { field: 'deletedAt' } }],
                should,
            },
        },
    });

    return resultLastMessages.hits.hits.reduce((prev, current) => {
        const m = current?._source;

        if (!m) { return prev; };

        m.id = current?._id;

        const id = m.conversationId!;
        if (prev[id]) {
            if (!prev[id].left || prev[id].left! < m.createdAt) {
                prev[id].left = m.createdAt;
            }
        }
        else {
            prev[id] = { left: m.createdAt };
        }

        if (types.includes(m.type)) {
            const latest = prev[id].latest;
            if (!latest || latest.createdAt < m.createdAt) {
                prev[id].latest = m;
            }
        }

        return prev;
    }, {} as ConversationLastMessages);
}

async function getParticipantConversationById(participant: string | undefined, id: string): Promise<Conversation | undefined> {
    const must: estypes.QueryDslQueryContainer[] = [
        {
            ids: {
                values: [id],
            }
        }
    ];

    if (participant) {
        must.push({
            term: {
                participants: {
                    value: participant,
                }
            }
        });
    }

    const result: estypes.SearchResponseBody<Conversation> = await client.search({
        index: conversationsIndex,
        size: 1,
        query: {
            bool: {
                must,
                must_not: {
                    exists: {
                        field: 'deletedAt'
                    }
                },
            }
        }
    });

    const h = result.hits.hits[0];

    return h?._source ? { ...h._source, id: h._id } : undefined;
}

async function getParticipantConversations(participant: string, excludeIds: string[], from: number = 0, size: number = 100): Promise<ConversationsResult> {
    let ids: string[] = [];

    if (size > 0) {
        const messagesResult: estypes.SearchResponseBody<Message, AggregationsConversationIdTermAggregate> = await client.search({
            index: messagesIndex,
            size: 0,
            query: {
                bool: {
                    must: {
                        term: {
                            participants: {
                                value: participant,
                            },
                        },
                    },
                    must_not: { terms: { conversationId: excludeIds } },
                },
            },
            aggs: {
                conversation_id_agg: {
                    aggs: {
                        timestamp_agg: {
                            max: {
                                script: 'Math.max(doc.createdAt.value.millis, Math.max(doc.updatedAt.size()==0 ? 0 : doc.updatedAt.value.millis, doc.deletedAt.size()==0 ? 0 : doc.deletedAt.value.millis))',
                            },
                        },
                        timestamp_bucket_sort: {
                            bucket_sort: { sort: [{ timestamp_agg: 'desc' }], size },
                        },
                    },
                    terms: { field: 'conversationId', size, order: { timestamp_agg: 'desc' } },
                },
            },
        });

        const buckets = messagesResult.aggregations!.conversation_id_agg.buckets as estypes.AggregationsStringTermsBucketKeys[];
        ids = buckets.map(b => b.key).filter(b => !!b);
    }

    const query = {
        bool: {
            must: {
                term: {
                    participants: {
                        value: participant,
                    }
                },
            },
            must_not: [
                {
                    ids: {
                        values: excludeIds,
                    }
                },
                {
                    exists: {
                        field: 'deletedAt'
                    }
                }],
        }
    }

    const result: estypes.SearchResponseBody<Conversation, AggregationsTotalCountValueAggregate> = await client.search({
        index: conversationsIndex,
        from,
        size,
        sort: [
            {
                _script: {
                    script: `int index = ${JSON.stringify(ids)}.indexOf(doc._id.value); index < 0 ? Integer.MAX_VALUE : index`,
                    type: 'number',
                }
            },
            { createdAt: 'desc' },
            { _id: 'desc' },
        ],
        query,
        aggs: {
            total_count: { value_count: { field: '_id' } }
        }
    });

    const hits = result.hits.hits.map(h => ({ ...h._source!, id: h._id }));

    var m = new Map(hits.map(i => [i.id, i]));

    const conversations = ids.map(id => m.get(id) as Conversation).filter(c => !!c);

    if (conversations.length < size) {
        const h = new Set(ids);
        conversations.push(...hits.filter(c => !h.has(c.id!)).slice(0, size - conversations.length));
    }

    return {
        conversations,
        from,
        size,
        total: result.aggregations?.total_count.value || result.hits.hits.length,
    };
}

async function getParticipantLastMessage(participant: string, conversationId: string): Promise<Message | undefined> {
    const result: estypes.SearchResponseBody<Message> = await client.search({
        index: messagesIndex,
        size: 1,
        sort: [
            { createdAt: 'desc' },
            { _id: 'desc' },
        ],
        query: {
            bool: {
                // must_not: [{ exists: { field: 'deletedAt' } }],
                must: [
                    { term: { fromId: { value: participant } } },
                    { term: { conversationId: { value: conversationId } } },
                ],
            }
        }
    });

    if (result?.hits.hits.length) {
        return result?.hits.hits.map(h => ({ ...h._source!, id: h._id }))[0];
    }
}

async function getPeerToPeerConversationId(peer1: string, peer2: string): Promise<string | undefined> {
    const id = [peer1, peer2].sort(undefined).join('-');

    const request: estypes.SearchRequest = {
        index: peerToPeerConversationsIndex,
        size: 1,
        query: {
            bool: {
                must: {
                    ids: {
                        values: [id],
                    }
                },
                must_not: {
                    exists: {
                        field: 'deletedAt'
                    }
                },
            }
        }
    };

    const result: estypes.SearchResponseBody<PeerToPeerConversation> = await client.search(request);

    const conversationId = result.hits.hits?.[0]?._source?.conversationId;

    if (conversationId) {
        return conversationId;
    }

    const saveResult = await client.index({
        index: conversationsIndex,
        body: {},
        refresh: 'wait_for',
    })

    if (saveResult.result !== 'created') {
        return;
    }

    const indexResult = await client.index({
        id,
        index: peerToPeerConversationsIndex,
        body: { conversationId: saveResult._id },
        refresh: 'wait_for',
        op_type: 'create',
    });

    if (indexResult.result !== 'created') {
        const deleteResult = await client.delete({
            id: saveResult._id,
            index: conversationsIndex,
            refresh: 'wait_for',
        });

        if (deleteResult.result !== 'deleted') {
            throw new Error('Delete null conversation failed');
        }

        const refreshResult = await client.indices.refresh({ index: conversationsIndex });

        if (refreshResult._shards.successful > 0) {
            const result2: estypes.SearchResponseBody<PeerToPeerConversation> = await client.search(request);
            return result2.hits.hits?.[0]?._source?.conversationId;
        }
    }

    return saveResult._id;
}

function saveConnection(userId: string, instanceId: string): Promise<SaveResponse> {
    return client.index({
        index: connectionsIndex,
        body: { userId, instanceId, timestamp: new Date() },
    })
}

function saveConversation(c: Conversation): Promise<SaveResponse> {
    return client.index({
        id: c.id,
        index: conversationsIndex,
        body: { ...c, id: undefined },
        refresh: 'wait_for',
    })
}

function saveMessage(m: Message): Promise<SaveResponse> {
    return client.index({
        id: m.id,
        index: messagesIndex,
        body: { ...m, id: undefined },
        refresh: 'wait_for',
    })
}

export function saveInstance(appId: string, details?: string): Promise<SaveResponse> {
    return client.index({
        index: instancesIndex,
        body: { appId, details, timestamp: new Date() },
    })
}

export async function initialize(config: Config): Promise<MessageStore> {
    if (client) {
        throw new Error('Already initialized');
    }

    connectionsIndex = config.connectionsIndex;
    conversationsIndex = config.conversationsIndex;
    instancesIndex = config.instancesIndex;
    messagesIndex = config.messagesIndex;
    peerToPeerConversationsIndex = config.peerToPeerConversationsIndex;

    client = new Client(config.options);

    let exists = await client.indices.exists({ index: instancesIndex });
    if (!exists) {
        await client.indices.create({
            index: instancesIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    appId: { type: 'keyword' },
                    details: { type: 'text' },
                    timestamp: { type: 'date' },
                }
            }
        });
    }

    exists = await client.indices.exists({ index: connectionsIndex });
    if (!exists) {
        await client.indices.create({
            index: connectionsIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    instanceId: { type: 'keyword' },
                    userId: { type: 'keyword' },
                    timestamp: { type: 'date' },
                }
            }
        });
    }

    exists = await client.indices.exists({ index: conversationsIndex });
    if (!exists) {
        await client.indices.create({
            index: conversationsIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    title: { type: 'text' },
                    participants: { type: 'keyword' },
                    createdBy: { type: 'keyword' },
                    createdAt: { type: 'date' },
                    updatedAt: { type: 'date' },
                    closedAt: { type: 'date' },
                    deletedAt: { type: 'date' },
                }
            }
        });
    }

    exists = await client.indices.exists({ index: peerToPeerConversationsIndex });
    if (!exists) {
        await client.indices.create({
            index: peerToPeerConversationsIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    conversationId: { type: 'keyword' },
                }
            }
        });
    }

    exists = await client.indices.exists({ index: messagesIndex });
    if (!exists) {
        await client.indices.create({
            index: messagesIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    type: { type: 'keyword' },
                    conversationId: { type: 'keyword' },
                    participants: { type: 'keyword' },
                    connectionId: { type: 'keyword' },
                    fromId: { type: 'keyword' },
                    clientMessageId: { type: 'keyword' },
                    createdAt: { type: 'date_nanos' },
                    updatedAt: { type: 'date' },
                    deletedAt: { type: 'date' },
                    data: {
                        dynamic: 'strict',
                        properties: {
                            conversationId: { type: 'keyword' },
                            messagesSize: { type: 'long', index: false },
                            closedAt: { type: 'date', index: false  },
                            deletedAt: { type: 'date', index: false  },
                            updatedAt: { type: 'date', index: false  },
                            participants: { type: 'keyword', index: false },
                            title: { type: 'text', index: false },
                            messageId: { type: 'keyword' },
                            text: { type: 'text', index: false  },
                            link: { type: 'keyword', index: false  },
                            name: { type: 'keyword', index: false  },
                            type: { type: 'keyword', index: false  },
                            size: { type: 'long', index: false  },
                        }
                    }
                }
            }
        });
    }

    return {
        findMessages,
        getConversationById,
        getLastMessagesTimestamps,
        getParticipantConversationById,
        getParticipantConversations,
        getParticipantLastMessage,
        getPeerToPeerConversationId,
        saveConnection,
        saveConversation,
        saveMessage,
    };
}