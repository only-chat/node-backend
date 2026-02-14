import { Client } from '@elastic/elasticsearch';

import type { ClientOptions } from '@elastic/elasticsearch';

import type { AuthenticationInfo, UserStore } from '@only-chat/types/userStore.js';

export interface StoreAuthenticationInfo extends AuthenticationInfo {
    name: string;
    password: string;
}

export type { ClientOptions } from '@elastic/elasticsearch';

export interface Config {
    options: ClientOptions;
    usersIndex: string;
}

export async function initialize(config: Config): Promise<UserStore> {
    const usersIndex = config.usersIndex;

    const client = new Client(config.options);

    const exists = await client.indices.exists({ index: usersIndex });
    if (!exists) {
        await client.indices.create({
            index: usersIndex,
            mappings: {
                dynamic: 'strict',
                properties: {
                    password: { type: "keyword" },
                    timestamp: { type: "date" },
                    deletedAt: { type: "date" },
                }
            }
        });
    }

    async function getUser(name: string, password: string): Promise<string | undefined> {
        const result = await client.search({
            index: usersIndex,
            size: 1,
            query: {
                bool: {
                    filter: [
                        { ids: { values: [name] } },
                        { term: { password: { value: password } } },
                        {
                            bool: {
                                must_not: {
                                    exists: {
                                        field: 'deletedAt'
                                    }
                                }
                            }
                        },
                    ]
                }
            }
        });

        return result?.hits.hits[0]?._id;
    }

    function saveUser(name: string, password: string) {
        return client.index({
            id: name,
            index: usersIndex,
            body: { password, timestamp: new Date() },
            op_type: 'create',
        })
    }

    return {
        async authenticate(info: StoreAuthenticationInfo) {
            if (info.name) {
                const name = info.name.trim().toLowerCase();

                let userId = await getUser(name, info.password);

                if (!userId) {
                    const result = await saveUser(name, info.password);
                    userId = result._id;
                }

                return userId;
            }
        }
    }
}