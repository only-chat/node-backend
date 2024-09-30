export interface AuthenticationInfo {}

export interface UserStore {
    /**
     * Verifies provided user credentials
     * 
     * @param authInfo User credentials
     * @returns User identifier
     */
    authenticate(authInfo: AuthenticationInfo): Promise<string | undefined>
}