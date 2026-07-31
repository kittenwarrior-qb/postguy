/**
 * A small chai-flavoured assertion library so scripts can write
 * `pg.expect(res.status).to.equal(200)` the way they would in Postman.
 */

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function stringify(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

class Assertion {
  #value;
  #negated = false;

  constructor(value) {
    this.#value = value;
  }

  // Chain words: purely for readability, they return the same assertion.
  get to() {
    return this;
  }
  get be() {
    return this;
  }
  get been() {
    return this;
  }
  get is() {
    return this;
  }
  get that() {
    return this;
  }
  get and() {
    return this;
  }
  get has() {
    return this;
  }
  get have() {
    return this;
  }
  get with() {
    return this;
  }
  get at() {
    return this;
  }
  get a() {
    return this;
  }
  get an() {
    return this;
  }

  get not() {
    this.#negated = !this.#negated;
    return this;
  }

  #assert(pass, message, negatedMessage) {
    const ok = this.#negated ? !pass : pass;
    if (ok) return this;
    const err = new Error(this.#negated ? negatedMessage : message);
    err.name = 'AssertionError';
    throw err;
  }

  // --- getters that assert immediately -------------------------------------
  get ok() {
    return this.#assert(
      Boolean(this.#value),
      `expected ${stringify(this.#value)} to be truthy`,
      `expected ${stringify(this.#value)} to be falsy`,
    );
  }

  get true() {
    return this.#assert(
      this.#value === true,
      `expected ${stringify(this.#value)} to be true`,
      `expected ${stringify(this.#value)} not to be true`,
    );
  }

  get false() {
    return this.#assert(
      this.#value === false,
      `expected ${stringify(this.#value)} to be false`,
      `expected ${stringify(this.#value)} not to be false`,
    );
  }

  get null() {
    return this.#assert(
      this.#value === null,
      `expected ${stringify(this.#value)} to be null`,
      `expected ${stringify(this.#value)} not to be null`,
    );
  }

  get undefined() {
    return this.#assert(
      this.#value === undefined,
      `expected ${stringify(this.#value)} to be undefined`,
      `expected ${stringify(this.#value)} not to be undefined`,
    );
  }

  get exist() {
    return this.#assert(
      this.#value !== null && this.#value !== undefined,
      `expected ${stringify(this.#value)} to exist`,
      `expected ${stringify(this.#value)} not to exist`,
    );
  }

  get empty() {
    const v = this.#value;
    const len =
      typeof v === 'string' || Array.isArray(v)
        ? v.length
        : v && typeof v === 'object'
          ? Object.keys(v).length
          : 0;
    return this.#assert(
      len === 0,
      `expected ${stringify(v)} to be empty`,
      `expected ${stringify(v)} not to be empty`,
    );
  }

  // --- methods -------------------------------------------------------------
  equal(expected) {
    return this.#assert(
      Object.is(this.#value, expected) || this.#value === expected,
      `expected ${stringify(this.#value)} to equal ${stringify(expected)}`,
      `expected ${stringify(this.#value)} not to equal ${stringify(expected)}`,
    );
  }

  eql(expected) {
    return this.#assert(
      deepEqual(this.#value, expected),
      `expected ${stringify(this.#value)} to deeply equal ${stringify(expected)}`,
      `expected ${stringify(this.#value)} not to deeply equal ${stringify(expected)}`,
    );
  }

  above(n) {
    return this.#assert(
      this.#value > n,
      `expected ${stringify(this.#value)} to be above ${n}`,
      `expected ${stringify(this.#value)} not to be above ${n}`,
    );
  }

  below(n) {
    return this.#assert(
      this.#value < n,
      `expected ${stringify(this.#value)} to be below ${n}`,
      `expected ${stringify(this.#value)} not to be below ${n}`,
    );
  }

  within(min, max) {
    return this.#assert(
      this.#value >= min && this.#value <= max,
      `expected ${stringify(this.#value)} to be within ${min}..${max}`,
      `expected ${stringify(this.#value)} not to be within ${min}..${max}`,
    );
  }

  oneOf(list) {
    return this.#assert(
      Array.isArray(list) && list.some((item) => deepEqual(item, this.#value)),
      `expected ${stringify(this.#value)} to be one of ${stringify(list)}`,
      `expected ${stringify(this.#value)} not to be one of ${stringify(list)}`,
    );
  }

  include(needle) {
    const v = this.#value;
    let pass = false;
    if (typeof v === 'string') pass = v.includes(String(needle));
    else if (Array.isArray(v)) pass = v.some((item) => deepEqual(item, needle));
    else if (v && typeof v === 'object' && needle && typeof needle === 'object') {
      pass = Object.entries(needle).every(([k, val]) => deepEqual(v[k], val));
    }
    return this.#assert(
      pass,
      `expected ${stringify(v)} to include ${stringify(needle)}`,
      `expected ${stringify(v)} not to include ${stringify(needle)}`,
    );
  }

  contain(needle) {
    return this.include(needle);
  }

  match(regex) {
    return this.#assert(
      regex instanceof RegExp && regex.test(String(this.#value)),
      `expected ${stringify(this.#value)} to match ${regex}`,
      `expected ${stringify(this.#value)} not to match ${regex}`,
    );
  }

  property(name, expected) {
    const v = this.#value;
    const has = v !== null && v !== undefined && Object.hasOwn(Object(v), name);
    if (arguments.length < 2) {
      return this.#assert(
        has,
        `expected ${stringify(v)} to have property ${stringify(name)}`,
        `expected ${stringify(v)} not to have property ${stringify(name)}`,
      );
    }
    return this.#assert(
      has && deepEqual(v[name], expected),
      `expected ${stringify(v)} to have property ${stringify(name)} of ${stringify(expected)}`,
      `expected ${stringify(v)} not to have property ${stringify(name)} of ${stringify(expected)}`,
    );
  }

  lengthOf(n) {
    const len = this.#value?.length ?? Object.keys(this.#value ?? {}).length;
    return this.#assert(
      len === n,
      `expected length ${len} to be ${n}`,
      `expected length ${len} not to be ${n}`,
    );
  }

  type(name) {
    return this.#assert(
      typeOf(this.#value) === name,
      `expected ${stringify(this.#value)} to be a ${name} but got ${typeOf(this.#value)}`,
      `expected ${stringify(this.#value)} not to be a ${name}`,
    );
  }

  /** `pg.expect(pg.response).to.have.status(200)` */
  status(code) {
    const actual = this.#value?.status ?? this.#value?.code;
    return this.#assert(
      actual === code,
      `expected response to have status ${code} but got ${actual}`,
      `expected response not to have status ${code}`,
    );
  }
}

export function expect(value) {
  return new Assertion(value);
}
