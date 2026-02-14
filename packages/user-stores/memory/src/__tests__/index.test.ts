import { describe, expect, beforeEach, it } from '@jest/globals';
import { initialize, users } from '../index.js';

import type { UserStore } from '@only-chat/types/userStore.js';

describe('authenticate', () => {
  let userStore: UserStore;

  beforeEach(async () => {
    userStore = await initialize();

    users.set('john', 'password123');
  });

  it('should return the username if authentication is successful', async () => {
    const info = {
      name: 'sara',
      password: 'password123',
    };

    const result = await userStore.authenticate(info);

    expect(result).toBe('sara');
  });

  it('should return undefined if the password is incorrect', async () => {
    const info = {
      name: 'john',
      password: 'password123',
    };

    const result1 = await userStore.authenticate(info);
    expect(result1).toBe('john');

    info.password = 'incorrect';
    const result2 = await userStore.authenticate(info);

    expect(result2).toBeUndefined();
  });

  it('should return undefined if the password is incorrect', async () => {
    const info = {
      password: 'password123',
    };

    const result = await userStore.authenticate(info);

    expect(result).toBeUndefined();
  });
});