export interface Log {
    debug(message?: any, ...optionalParams: any[]): void
    error(message?: any, ...optionalParams: any[]): void
    info(message?: any, ...optionalParams: any[]): void
    log(message?: any, ...optionalParams: any[]): void
    trace(message?: any, ...optionalParams: any[]): void
    warn(message?: any, ...optionalParams: any[]): void
}