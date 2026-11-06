// Load test: many people editing boards at once, each in a group of five on the same board.
//   docker compose up -d --build
//   docker run --rm -i --network host grafana/k6 run - < loadtest/boards.js
// Options: -e BASE_URL=http://localhost:8080 -e USERS=100 -e DURATION=2m
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const USERS = Number(__ENV.USERS || 50);
const PER_BOARD = 5;

export const options = {
  scenarios: {
    editing: {
      executor: 'constant-vus',
      vus: USERS,
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    'http_req_failed{type:save}': ['rate<0.01'],
    'http_req_duration{type:save}': ['p(95)<250'],
    'http_req_duration{type:load}': ['p(95)<300'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

// One owner per group creates the board and an editor link; the others join with it.
export function setup() {
  const groups = [];
  for (let g = 0; g < Math.ceil(USERS / PER_BOARD); g++) {
    const jar = http.cookieJar();
    signUp(`owner${g}`);
    const board = http.post(`${BASE}/api/boards`, JSON.stringify({ title: `Load ${g}` }), json).json();
    const link = http.post(`${BASE}/api/boards/${board.id}/links`, JSON.stringify({ role: 'editor' }), json).json();
    groups.push({ boardId: board.id, token: link.token });
    jar.clear(BASE);
  }

  return { groups };
}

function signUp(name) {
  const res = http.post(
    `${BASE}/api/account/signup`,
    JSON.stringify({ email: `${name}-${Date.now()}-${Math.random()}@load.test`, name, password: 'load-test-password' }),
    json,
  );
  check(res, { 'signed up': (r) => r.status === 200 });
}

let joined = false;
let shapeCount = 0;

export default function (data) {
  const vu = exec.vu.idInTest;
  const group = data.groups[(vu - 1) % data.groups.length];

  if (!joined) {
    signUp(`user${vu}`);
    http.post(`${BASE}/api/invites/${group.token}/accept`, null);
    const load = http.get(`${BASE}/api/boards/${group.boardId}`, { tags: { type: 'load' } });
    check(load, { 'board opens': (r) => r.status === 200 });
    joined = true;
  }

  // Roughly what a person does: add a note now and then, and move things around a lot.
  const id = `vu${vu}-${shapeCount}`;
  const ops = shapeCount === 0 || Math.random() < 0.2
    ? [{ type: 'add', shape: { id, kind: 'sticky', x: Math.random() * 2000, y: Math.random() * 1200, w: 180, h: 140, color: '#fde68a', z: shapeCount + 1, text: `note ${shapeCount}` } }]
    : [{ type: 'update', id: `vu${vu}-${Math.floor(Math.random() * shapeCount)}`, patch: { x: Math.random() * 2000, y: Math.random() * 1200 } }];
  if (ops[0].type === 'add') {
    shapeCount++;
  }

  const save = http.post(`${BASE}/api/boards/${group.boardId}/ops`, JSON.stringify({ ops }), { ...json, tags: { type: 'save' } });
  check(save, { saved: (r) => r.status === 200 });
  sleep(0.5 + Math.random());
}
