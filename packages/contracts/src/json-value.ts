import { z } from 'zod';

export type JsonPrimitiveValue = string | number | boolean | null;
export type JsonValue = JsonPrimitiveValue | JsonValue[] | { [key: string]: JsonValue };

const isPlainJsonObject = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' &&
  input !== null &&
  !Array.isArray(input) &&
  (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null);

type JsonValueFrame = {
  value: Record<string, unknown> | unknown[];
  children: unknown[];
  nextChildIndex: number;
};

const isNonNaNFiniteNumber = (value: number): value is number => Number.isFinite(value);

const getJsonArrayChildren = (value: unknown[]): unknown[] | undefined => {
  const length = value.length;
  if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
  const ownPropertyNames = Object.getOwnPropertyNames(value);
  if (ownPropertyNames.length > length + 1) return undefined;

  for (let i = 0; i < length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return undefined;
  }

  for (const key of ownPropertyNames) {
    if (key === 'length') continue;
    if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
    if (Number(key) >= length) return undefined;
  }

  const children: unknown[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    children[i] = value[i];
  }
  return children;
};

const getJsonObjectChildren = (value: Record<string, unknown>): unknown[] | undefined => {
  if (!isPlainJsonObject(value)) return undefined;
  if (Object.getOwnPropertySymbols(value).length > 0) return undefined;

  const ownPropertyNames = Object.getOwnPropertyNames(value);
  const children: unknown[] = [];
  for (const key of ownPropertyNames) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return undefined;
    children.push(value[key]);
  }
  return children;
};

const isPrimitiveJsonValue = (value: unknown): boolean => (
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && isNonNaNFiniteNumber(value))
);

const isValidJsonValue = (input: unknown): boolean => {
  if (isPrimitiveJsonValue(input)) return true;
  if (typeof input !== 'object' || input === null) return false;

  const stack: JsonValueFrame[] = [];
  const inProgress = new Set<object>();

  const pushObject = (value: Record<string, unknown> | unknown[]): boolean => {
    if (inProgress.has(value as object)) return false;

    const children = Array.isArray(value) ? getJsonArrayChildren(value) : getJsonObjectChildren(value);
    if (children === undefined) return false;

    inProgress.add(value as object);
    stack.push({
      value,
      children,
      nextChildIndex: 0,
    });
    return true;
  };

  if (!pushObject(input as Record<string, unknown> | unknown[])) {
    return false;
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.nextChildIndex >= frame.children.length) {
      inProgress.delete(frame.value as object);
      stack.pop();
      continue;
    }

    const child = frame.children[frame.nextChildIndex];
    frame.nextChildIndex += 1;

    if (child === null || isPrimitiveJsonValue(child)) {
      continue;
    }
    if (child === undefined || typeof child !== 'object') return false;

    if (!pushObject(child as Record<string, unknown> | unknown[])) return false;
  }

  return true;
};

export const JsonValueSchema = z.custom<JsonValue>(isValidJsonValue, {
  message: 'must be a plain JSON value',
});
