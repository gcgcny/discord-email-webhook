#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const yaml = require('yaml');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePathSegment(segment) {
  return String(segment || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildLocalUrl(config) {
  const port = Number(config.port || 5401);
  const path = normalizePathSegment(config.webhook_path);
  return `http://localhost:${port}/${path}`;
}

function buildHeaders(baseHeaders, bodyBuffer, config) {
  const headers = {};

  for (const [key, value] of Object.entries(baseHeaders || {})) {
    const lower = key.toLowerCase();
    if (lower === 'host') continue;
    if (lower === 'content-length') continue;
    if (lower === 'connection') continue;
    headers[key] = String(value);
  }

  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  // Always ensure Content-Length is correct for the raw bytes we send.
  headers['Content-Length'] = String(bodyBuffer.length);

  // If configured, compute signature from raw body bytes.
  if (config.fe_webhook_signature_key) {
    const keyBuffer = Buffer.from(String(config.fe_webhook_signature_key), 'ascii');
    const sig = crypto.createHmac('sha256', keyBuffer).update(bodyBuffer).digest('hex');
    headers['x-webhook-signature'] = sig;
  }

  return headers;
}

function request(urlString, { method, headers, bodyBuffer }) {
  const url = new URL(urlString);

  const options = {
    method,
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);

    if (bodyBuffer && bodyBuffer.length > 0) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    if (idx === -1) return fallback;
    const next = args[idx + 1];
    if (!next || next.startsWith('--')) return fallback;
    return next;
  };

  const configPath = getArg('--config', 'config.yml');
  const bodyPath = getArg('--body', 'request_body.json');
  const headersPath = getArg('--headers', 'request_headers.json');
  const explicitUrl = getArg('--url', null);

  const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
  const url = explicitUrl || buildLocalUrl(config);

  const bodyBuffer = fs.readFileSync(bodyPath);
  const baseHeaders = fs.existsSync(headersPath) ? readJson(headersPath) : {};
  const headers = buildHeaders(baseHeaders, bodyBuffer, config);

  const res = await request(url, {
    method: 'POST',
    headers,
    bodyBuffer
  });

  console.log(`POST ${url}`);
  console.log(`Status: ${res.statusCode}`);
  if (res.body) console.log(res.body);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
