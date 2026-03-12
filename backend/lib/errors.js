"use strict";

class BaseError extends Error {
    constructor(message, context = {}, isOperational = true) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.name = this.constructor.name;
        this.context = context;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }
}

class BrowserError extends BaseError {
    constructor(message, context = {}) {
        super(message, context);
    }
}

class SelectorError extends BaseError {
    constructor(selector, message = 'Element not found', context = {}) {
        super(`${message}: ${selector}`, { ...context, selector });
    }
}

class AuthError extends BaseError {
    constructor(message, context = {}) {
        super(message, context);
    }
}

class NetworkError extends BaseError {
    constructor(message, context = {}) {
        super(message, context);
    }
}

class AppError extends BaseError {
    constructor(message, context = {}) {
        super(message, context);
    }
}

module.exports = {
    BaseError,
    BrowserError,
    SelectorError,
    AuthError,
    NetworkError,
    AppError
};
