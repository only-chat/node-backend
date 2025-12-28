export interface AuthenticationInfo {}

export interface UserStore {
    /**
     * Authenticates a user
     * 
     * @param info - Authentication information containing name and password
     * 
     * @returns Promise<string | undefined> - User ID if authentication successful
     *          or new user created, undefined if no name provided
     * 
     * Security Consideration: In production, passwords should be hashed
     *       before storage.
     */
    authenticate(authInfo: AuthenticationInfo): Promise<string | undefined>
}