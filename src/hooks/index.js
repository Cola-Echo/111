/**
 * Hooks 模块导出
 * @module hooks
 */

export {
    hookSendButton,
    stopProcessing,
    getIsProcessing,
    setIsProcessing,
    createAbortController,
    getAbortController,
    getSkipNextHook,
    setSkipNextHook,
    setProcessMemoryCallback,
    resetHookState,
} from './send-button-hook';

export {
    registerInterceptor,
    unregisterInterceptor,
} from './interceptor';
