export default class AppError extends Error {
    statusCode: number;
    status: string;
    isOperational: boolean;
    code?: string;
    details?: any;

    constructor(message: string, statusCode: number, code?: string, details?: any) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        this.code = code;
        this.details = details;

        Error.captureStackTrace(this, this.constructor);
    }
}
