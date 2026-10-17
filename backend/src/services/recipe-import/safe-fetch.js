// fetch() for URLs typed by users.
// The server fetches whatever link it is given, so without checks anyone could make it call
// internal addresses (localhost, cloud metadata, the MongoDB host...): classic SSRF.
// Two layers:
//   1. assertPublicUrl() rejects early, with a clear message, links to a private address;
//   2. the connection itself only opens to an address checked at that very moment (custom DNS
//      lookup in the HTTP agent): a domain answering a public IP to the first check and
//      127.0.0.1 to the connection (DNS rebinding) is stopped too.
// Addresses are parsed by ipaddr.js, which understands every spelling (IPv4-mapped IPv6 in hex
// form such as [::ffff:7f00:1], NAT64, 6to4...): only plain public unicast addresses pass.

const dns = require('dns');
const net = require('net');
const ipaddr = require('ipaddr.js');
const { Agent, fetch } = require('undici');
const { ImportError } = require('./errors');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;
const BLOCKED_MESSAGE = "Ce lien n'est pas autorisé";

class BlockedAddressError extends Error {
  constructor(address) {
    super(`Blocked address ${address}`);
    this.code = 'EBLOCKEDADDRESS';
  }
}

function isPublicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}

/** DNS lookup that only ever hands out public addresses (used for every connection). */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const blocked = addresses.find(({ address }) => !isPublicAddress(address));
    if (blocked || addresses.length === 0) return callback(new BlockedAddressError(blocked?.address || hostname));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const agent = new Agent({ connect: { lookup: publicLookup } });

async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportError(400, "Ce lien n'est pas valide");
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportError(400, 'Seuls les liens http(s) sont acceptés');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.promises.lookup(host, { all: true })).map(entry => entry.address);
    } catch {
      throw new ImportError(422, "Impossible de joindre ce site. Vérifie le lien.");
    }
  }

  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new ImportError(400, BLOCKED_MESSAGE);
  }

  return url;
}

/**
 * fetch() with the SSRF checks above on every redirect hop, and a timeout.
 * Returns the final Response; `response.finalUrl` is the URL after redirects.
 */
async function safeFetch(rawUrl, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    let response;
    try {
      response = await fetch(url, {
        ...fetchOptions,
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error.cause?.code === 'EBLOCKEDADDRESS') throw new ImportError(400, BLOCKED_MESSAGE);
      throw error;
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }

    response.finalUrl = url.toString();
    return response;
  }

  throw new ImportError(422, 'Trop de redirections sur ce lien');
}

/** Reads a response body into a Buffer, refusing anything bigger than maxBytes. */
async function readBodyLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (declared && declared > maxBytes) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

module.exports = { safeFetch, readBodyLimited, assertPublicUrl, isPublicAddress };
