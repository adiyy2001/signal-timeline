import type { Result } from 'axe-core';
import { connect, draw, drawStarterScene, openEditor, undo } from '../support/editor';

const axeOptions: Parameters<typeof cy.checkA11y>[1] = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
};

function reportViolations(violations: readonly Result[]): void {
  const lines = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
  cy.task('log', lines.join('\n'), { log: false });
}

function checkEditor(): void {
  cy.checkA11y(undefined, axeOptions, reportViolations);
}

describe('accessibility with axe', () => {
  beforeEach(() => {
    openEditor();
    cy.injectAxe();
  });

  it('has no violations on the empty editor', () => {
    cy.window().should('have.property', 'axe');
    checkEditor();
  });

  it('has no violations with shapes, a connector and a selection', () => {
    drawStarterScene();
    cy.get('[data-shape-id]').first().click({ force: true });
    checkEditor();
  });

  it('has no violations with a branch in the history tree', () => {
    drawStarterScene();
    undo();
    draw('Rectangle', [400, 380], [560, 470]);
    checkEditor();
  });

  it('has no violations in the dark theme', () => {
    drawStarterScene();
    cy.get('.theme-button').click();
    cy.get('.theme-button').click();
    cy.get('html').should('have.attr', 'data-theme', 'dark');
    checkEditor();
  });

  it('has no violations while a connector is half made', () => {
    draw('Rectangle', [80, 120], [260, 220]);
    connect([170, 170], [171, 171]);
    checkEditor();
  });
});
