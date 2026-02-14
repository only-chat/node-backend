import type { AuthenticationInfo, UserStore } from '@only-chat/types/userStore.js';

export interface StoreAuthenticationInfo extends AuthenticationInfo {
    name: string;
    password: string;
}

export const users = new Map<string, string>();

export async function initialize(): Promise<UserStore> {
    users.clear();

    return {
        async authenticate(info: StoreAuthenticationInfo) {
            if (info.name) {
                const name = info.name.trim().toLowerCase();

                let password = users.get(name);

                if (password) {
                    if (password !== info.password) {
                        return;
                    }
                } else {
                    users.set(name, info.password);
                }

                return name;
            }
        }
    }
}