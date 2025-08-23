// fix apache-arrow.d.ts

import type {
  StreamPipeOptions as _StreamPipeOptions,
  ReadableStreamReadResult as _ReadableStreamReadResult,
} from 'node:stream/web';

// apache-arrow has broken types that assume the WebWorker lib
// https://github.com/apache/arrow-js/issues/45

declare global {
  export type StreamPipeOptions = _StreamPipeOptions;
  export type ReadableStreamReadResult<T> = _ReadableStreamReadResult<T>;
}