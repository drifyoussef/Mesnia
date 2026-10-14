/**
 * A request value used in a Mongo query must be a plain string: a JSON object such as
 * { "$ne": null } would otherwise be read as an operator and match any document.
 * Anything else (object, array, number, missing) becomes ''.
 */
function asString(value, max = 320) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

module.exports = { asString };
