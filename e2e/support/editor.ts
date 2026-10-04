export type Corner = readonly [number, number];

const worldWidth = 960;
const worldHeight = 600;

interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

function toClient(point: Corner): Cypress.Chainable<ClientPoint> {
  return cy.get('svg.surface').then(($svg) => {
    const box = $svg[0]?.getBoundingClientRect() ?? new DOMRect();
    return {
      clientX: box.left + (point[0] / worldWidth) * box.width,
      clientY: box.top + (point[1] / worldHeight) * box.height,
    };
  });
}

function fire(type: 'pointerdown' | 'pointermove' | 'pointerup', point: ClientPoint): void {
  cy.get('svg.surface').trigger(type, {
    ...point,
    button: 0,
    pointerId: 1,
    eventConstructor: 'PointerEvent',
    force: true,
  });
}

export function drag(from: Corner, to: Corner): void {
  toClient(from).then((start) => {
    toClient([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]).then((middle) => {
      toClient(to).then((end) => {
        fire('pointerdown', start);
        fire('pointermove', middle);
        fire('pointermove', end);
        fire('pointerup', end);
      });
    });
  });
}

export function click(point: Corner): void {
  toClient(point).then((client) => {
    fire('pointerdown', client);
    fire('pointerup', client);
  });
}

export function pickTool(name: 'Select' | 'Rectangle' | 'Ellipse' | 'Connector'): void {
  cy.contains('button', new RegExp(`^\\s*${name}\\s*$`)).click();
}

export function draw(tool: 'Rectangle' | 'Ellipse', from: Corner, to: Corner): void {
  pickTool(tool);
  drag(from, to);
}

export function connect(from: Corner, to: Corner): void {
  pickTool('Connector');
  drag(from, to);
}

export function undo(): void {
  cy.get('body').type('{ctrl}z');
}

export function redo(): void {
  cy.get('body').type('{ctrl}{shift}z');
}

export const shapes = () => cy.get('[data-shape-id]');
export const connectors = () => cy.get('[data-connector-id]');
export const treeItems = () => cy.get('st-branch-tree [role="treeitem"]');
export const autosaveCount = () => cy.get('[data-test="autosave-count"]');

export function openEditor(): void {
  cy.visit('');
  cy.get('svg.surface').should('be.visible');
}

export function drawStarterScene(): void {
  draw('Rectangle', [80, 120], [260, 220]);
  draw('Ellipse', [520, 100], [700, 200]);
  connect([170, 170], [610, 150]);
}
