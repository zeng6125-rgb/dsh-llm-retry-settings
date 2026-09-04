// src/index.ts
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ../../AppData/Roaming/DSH Desktop/agent/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
    return true;
  }) ?? Object.keys({
    ...a,
    ...b
  }).every((key) => deepEqual(a[key], b[key], strict));
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// ../../AppData/Roaming/DSH Desktop/agent/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
var resolvers = {};
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/index.ts
var name = "dsh-llm-retry-settings";
var DIAG_TAG = "v0.1.7-diag2";
var DIAG_MAX_BYTES = 256 * 1024;
var diagDir;
function diag(message) {
  try {
    if (!diagDir) {
      const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh");
      diagDir = join(home, "logs", "dsh-llm-retry-settings");
      mkdirSync(diagDir, { recursive: true });
    }
    const file = join(diagDir, "host.log");
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`;
    try {
      if (statSync(file).size > DIAG_MAX_BYTES) {
        writeFileSync(file, line);
        return;
      }
    } catch {
    }
    appendFileSync(file, line);
  } catch {
  }
}
var inject = ["settings", "agents", "sessions"];
var NS = "dsh-llm-retry";
var CONTINUATION_TEXT = "\u4E0A\u4E00\u6761\u56DE\u590D\u56E0\u8FBE\u5230\u8F93\u51FA token \u4E0A\u9650\u88AB\u622A\u65AD\u3002\u8BF7\u4ECE\u4E2D\u65AD\u5904\u76F4\u63A5\u7EE7\u7EED\u8F93\u51FA\uFF0C\u4E0D\u8981\u91CD\u590D\u5DF2\u7ECF\u8F93\u51FA\u7684\u5185\u5BB9\uFF0C\u4E5F\u4E0D\u8981\u91CD\u65B0\u5F00\u5934\u3002";
var DEFAULT_RETRYABLE_CODES = ["INVALID_REQUEST", "PI_AI_ERROR"];
var DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 1e4,
  jitterRatio: 0.1,
  retryableCodes: [...DEFAULT_RETRYABLE_CODES],
  autoContinue: false,
  maxContinuations: 2
};
var Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULTS.enabled),
  maxRetries: Schema.number().step(1).min(0).default(DEFAULTS.maxRetries),
  initialDelayMs: Schema.number().min(1).default(DEFAULTS.initialDelayMs),
  maxDelayMs: Schema.number().min(1).default(DEFAULTS.maxDelayMs),
  jitterRatio: Schema.number().min(0).max(1).default(DEFAULTS.jitterRatio),
  retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
  autoContinue: Schema.boolean().default(DEFAULTS.autoContinue),
  maxContinuations: Schema.number().step(1).min(0).default(DEFAULTS.maxContinuations)
});
var normCodes = (v) => Array.isArray(v) ? v.filter((c) => typeof c === "string" && c.length > 0) : [];
var asBool = (v) => typeof v === "boolean" ? v : void 0;
var asInt = (v, min) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : void 0;
var asFloat = (v, min, max) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : void 0;
function normalizeConfig(raw) {
  const cfg = {
    enabled: asBool(raw?.enabled) ?? DEFAULTS.enabled,
    maxRetries: asInt(raw?.maxRetries, 0) ?? DEFAULTS.maxRetries,
    initialDelayMs: asInt(raw?.initialDelayMs, 1) ?? DEFAULTS.initialDelayMs,
    maxDelayMs: asInt(raw?.maxDelayMs, 1) ?? DEFAULTS.maxDelayMs,
    jitterRatio: asFloat(raw?.jitterRatio, 0, 1) ?? DEFAULTS.jitterRatio,
    retryableCodes: Array.isArray(raw?.retryableCodes) ? normCodes(raw.retryableCodes) : [...DEFAULT_RETRYABLE_CODES],
    autoContinue: asBool(raw?.autoContinue) ?? DEFAULTS.autoContinue,
    maxContinuations: asInt(raw?.maxContinuations, 0) ?? DEFAULTS.maxContinuations
  };
  if (cfg.initialDelayMs > cfg.maxDelayMs) cfg.initialDelayMs = cfg.maxDelayMs;
  return cfg;
}
function lastTurnEnd(session) {
  const log = session?.log;
  if (!Array.isArray(log)) return void 0;
  for (let i = log.length - 1, floor = Math.max(-1, log.length - 400); i > floor; i -= 1) {
    const event = log[i];
    if (event?.type !== "turn/end") continue;
    return {
      turn: typeof event.data?.turn === "number" ? event.data.turn : -1,
      kind: typeof event.data?.reason?.kind === "string" ? event.data.reason.kind : ""
    };
  }
  return void 0;
}
function makeContinuationMessage() {
  return Object.freeze({
    id: randomUUID(),
    role: "user",
    content: Object.freeze([Object.freeze({ type: "text", text: CONTINUATION_TEXT })]),
    source: Object.freeze({ kind: "plugin", plugin: NS })
  });
}
function apply(ctx, config) {
  const live = normalizeConfig(config);
  diag(`activate ${DIAG_TAG} inject=[${inject.join(",")}] pid=${process.pid} raw=${JSON.stringify(config ?? null)} live=${JSON.stringify(live)}`);
  let scopeRef;
  const current = () => {
    if (scopeRef) {
      try {
        syncFromScope(scopeRef.get());
      } catch (error) {
        diag(`scope.get \u5931\u8D25\uFF0C\u6CBF\u7528 live\uFF1A${String(error)}`);
      }
    }
    return live;
  };
  const syncFromScope = (next) => {
    if (!next || typeof next !== "object") return;
    Object.assign(
      live,
      normalizeConfig({
        enabled: asBool(next.enabled) ?? live.enabled,
        maxRetries: asInt(next.maxRetries, 0) ?? live.maxRetries,
        initialDelayMs: asInt(next.initialDelayMs, 1) ?? live.initialDelayMs,
        maxDelayMs: asInt(next.maxDelayMs, 1) ?? live.maxDelayMs,
        jitterRatio: asFloat(next.jitterRatio, 0, 1) ?? live.jitterRatio,
        retryableCodes: Array.isArray(next.retryableCodes) ? next.retryableCodes : live.retryableCodes,
        autoContinue: asBool(next.autoContinue) ?? live.autoContinue,
        maxContinuations: asInt(next.maxContinuations, 0) ?? live.maxContinuations
      })
    );
  };
  ctx.inject(["settings"], (sctx) => {
    try {
      if (!sctx?.settings || typeof sctx.settings.register !== "function") {
        diag("settings \u670D\u52A1\u7F3A\u5C11 register\uFF0C\u8DF3\u8FC7\u547D\u540D\u7A7A\u95F4\u6CE8\u518C");
        return;
      }
      const scope = sctx.settings.register(NS, Config, { base: config || {} });
      scopeRef = scope;
      syncFromScope(scope.get());
      diag(`settings registered; resolved=${JSON.stringify(scope.get())}`);
      scope.watch((next) => {
        try {
          syncFromScope(next ?? scope.get());
          diag(`settings sync: autoContinue=${live.autoContinue} maxContinuations=${live.maxContinuations} enabled=${live.enabled}`);
        } catch (error) {
          diag(`settings sync \u5931\u8D25\uFF1A${String(error)}`);
          ctx.logger.warn("[dsh-llm-retry-settings] \u8BBE\u7F6E\u540C\u6B65\u5931\u8D25", error);
        }
      });
    } catch (error) {
      diag(`settings register \u5931\u8D25\uFF1A${String(error)}`);
      ctx.logger.warn("[dsh-llm-retry-settings] settings \u6CE8\u518C\u5931\u8D25", error);
    }
  });
  ctx.on(
    "agent/request-error",
    (payload, next) => {
      const cfg = current();
      diag(`request-error enabled=${cfg.enabled} code=${payload?.code ?? payload?.failure?.code ?? "(n/a)"} keys=${Object.keys(payload ?? {}).join("|")}`);
      if (cfg.enabled && payload && payload.retryPolicy && typeof payload.retryPolicy === "object") {
        const p = payload.retryPolicy;
        const mergedCodes = cfg.retryableCodes.length > 0 ? [.../* @__PURE__ */ new Set([...p.retryableCodes ?? [], ...cfg.retryableCodes])] : p.retryableCodes;
        payload.retryPolicy = {
          ...p,
          ...p.mode === "normal" ? { maxRetries: cfg.maxRetries } : {},
          ...mergedCodes ? { retryableCodes: mergedCodes } : {},
          initialDelayMs: cfg.initialDelayMs,
          maxDelayMs: cfg.maxDelayMs,
          jitterRatio: cfg.jitterRatio
        };
      }
      return next ? next() : void 0;
    },
    { prepend: true }
  );
  const states = /* @__PURE__ */ new Map();
  const stateOf = (id) => {
    let state = states.get(id);
    if (!state) {
      state = { chain: 0, capped: false, lastTurn: -1 };
      states.set(id, state);
    }
    return state;
  };
  const handleTurnEnd = (session, turn, kind, via, agentHint) => {
    const cfg = current();
    const state = stateOf(String(session.id));
    if (state.lastTurn === turn) return;
    state.lastTurn = turn;
    if (kind !== "max-tokens") {
      state.chain = 0;
      state.capped = false;
      return;
    }
    diag(`turn/end via=${via} session=${session.id} turn=${turn} autoContinue=${cfg.autoContinue} maxContinuations=${cfg.maxContinuations} chain=${state.chain}`);
    if (!cfg.autoContinue) return;
    if (state.chain >= cfg.maxContinuations) {
      if (!state.capped) {
        state.capped = true;
        diag(`bail via=${via}: \u8FDE\u7EED\u7EED\u5199\u89E6\u9876\uFF08${state.chain}/${cfg.maxContinuations}\uFF09session=${session.id}`);
        ctx.logger.info(
          `[dsh-llm-retry-settings] \u4F1A\u8BDD ${session.id} \u8FDE\u7EED\u7EED\u5199\u5DF2\u8FBE\u4E0A\u9650\uFF08${cfg.maxContinuations} \u6B21\uFF09\uFF0C\u505C\u6B62\u81EA\u52A8\u7EED\u5199`
        );
      }
      return;
    }
    let agent = agentHint;
    if (!agent) {
      const agents = ctx.agents;
      if (!agents || typeof agents.get !== "function") {
        diag(`bail via=${via}: ctx.agents \u4E0D\u53EF\u7528\uFF08inject \u672A\u6EE1\u8DB3\uFF1F\uFF09`);
        return;
      }
      agent = agents.get(session.id);
      if (!agent) {
        diag(`bail via=${via}: agents.get(${session.id}) \u65E0\u5B9E\u4F8B`);
        return;
      }
    }
    if (agent.session?.id !== session.id) {
      diag(`bail via=${via}: agent.session.id=${agent.session?.id} \u4E0E\u4E8B\u4EF6 session.id=${session.id} \u4E0D\u7B26`);
      return;
    }
    if (typeof agent.followup !== "function") {
      diag(`bail via=${via}: agent.followup \u4E0D\u662F\u51FD\u6570\uFF08type=${typeof agent.followup}\uFF09`);
      return;
    }
    const deliver = (attempt) => {
      try {
        agent.followup(makeContinuationMessage());
        diag(`\u7EED\u5199\u5DF2\u6295\u9012 via=${via} attempt=${attempt} session=${session.id} turn=${turn} chain=${state.chain}/${cfg.maxContinuations}`);
      } catch (error) {
        diag(`\u7EED\u5199\u6295\u9012\u5931\u8D25 via=${via} attempt=${attempt} session=${session.id} turn=${turn}\uFF1A${String(error)}`);
        if (attempt === 1) setTimeout(() => deliver(2), 0);
      }
    };
    state.chain += 1;
    queueMicrotask(() => deliver(1));
  };
  ctx.on(
    "session/event",
    (session, event) => {
      try {
        if (!session || !event || typeof event.type !== "string") return;
        switch (event.type) {
          case "user/message": {
            const state = stateOf(String(session.id));
            const source = event.data && event.data.source;
            const kind = source && source.kind;
            if (kind === "user") {
              if (state.chain > 0) diag(`\u4EBA\u5DE5\u53D1\u8A00\uFF0C\u91CD\u7F6E\u7EED\u5199\u94FE session=${session.id} chain=${state.chain}`);
              state.chain = 0;
              state.capped = false;
              return;
            }
            if (kind === "plugin" && source.plugin === NS) {
              diag(`\u7EED\u5199\u6D88\u606F\u5DF2\u5165\u4F1A\u8BDD session=${session.id}`);
            }
            return;
          }
          case "turn/end": {
            const reason = event.data && event.data.reason;
            if (!reason || typeof reason.kind !== "string") return;
            handleTurnEnd(session, typeof event.data.turn === "number" ? event.data.turn : -1, reason.kind, "session/event");
            return;
          }
          default:
            return;
        }
      } catch (error) {
        diag(`\u81EA\u52A8\u7EED\u5199\u5904\u7406\u5F02\u5E38\uFF08session/event\uFF09\uFF1A${error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error)}`);
        ctx.logger.warn("[dsh-llm-retry-settings] \u81EA\u52A8\u7EED\u5199\u5904\u7406\u5931\u8D25", error);
      }
    }
  );
  ctx.on("agent/status", (payload) => {
    try {
      if (!payload || payload.status !== "idle") return;
      const session = payload.agent?.session;
      if (!session || session.id === void 0) return;
      const end = lastTurnEnd(session);
      if (!end) return;
      handleTurnEnd(session, end.turn, end.kind, "agent/status", payload.agent);
    } catch (error) {
      diag(`\u81EA\u52A8\u7EED\u5199\u5904\u7406\u5F02\u5E38\uFF08agent/status\uFF09\uFF1A${String(error)}`);
    }
  });
  ctx.on("session/disposed", (session) => {
    if (session) states.delete(String(session.id));
  });
}
export {
  Config,
  DEFAULTS,
  apply,
  inject,
  name
};
