import { connectors, openEditor, shapes, treeItems } from '../support/editor';

const keys = Cypress.Keyboard.Keys;

describe('keyboard only', () => {
  beforeEach(() => {
    openEditor();
  });

  it('builds a drawing, edits it and travels through the history without a pointer', () => {
    cy.contains('button', 'Add rectangle').focus().type('{enter}');
    shapes().should('have.length', 1);
    cy.contains('button', 'Add ellipse').focus().type('{enter}');
    shapes().should('have.length', 2);

    shapes().first().focus();
    cy.press(keys.RIGHT);
    cy.press(keys.RIGHT);
    cy.press(keys.DOWN);
    shapes().first().should('have.attr', 'aria-label').and('contain', 'at 150, 105');
    treeItems().should('have.length', 4);

    cy.contains('button', /^\s*Connector\s*$/)
      .focus()
      .type('{enter}');
    shapes().first().focus();
    cy.press(keys.ENTER);
    shapes().last().focus();
    cy.press(keys.SPACE);
    connectors().should('have.length', 1);
    treeItems().should('have.length', 5);

    cy.get('body').type('{ctrl}z');
    connectors().should('have.length', 0);
    cy.get('body').type('{ctrl}{shift}z');
    connectors().should('have.length', 1);

    shapes().last().focus();
    cy.press(keys.DELETE);
    shapes().should('have.length', 1);
    connectors().should('have.length', 0);
    cy.focused().should('have.class', 'surface');
  });

  it('reaches every control in a sensible Tab order', () => {
    cy.get('body').focus();
    const expected = [
      'Skip to the drawing',
      'Color theme',
      'Select',
      'Rectangle',
      'Ellipse',
      'Connector',
      'Add rectangle',
      'Add ellipse',
    ];
    cy.get('body').click(0, 0);
    expected.forEach((name) => {
      cy.press(keys.TAB);
      cy.focused().should(($element) => {
        const text = `${$element.text()} ${$element.attr('aria-label') ?? ''}`;
        expect(text).to.contain(name);
      });
    });
  });

  it('shows a visible focus indicator after a Tab key press', () => {
    cy.contains('button', 'Add rectangle').focus().type('{enter}');
    shapes().should('have.length', 1);
    cy.contains('button', 'Add rectangle').focus();
    cy.press(keys.TAB);
    cy.focused().should('contain.text', 'Add ellipse').and('have.css', 'outline-style', 'solid');
    cy.contains('button', /^\s*Delete/).focus();
    cy.press(keys.TAB);
    cy.focused().should('have.attr', 'data-shape-id');
    cy.get('[data-shape-id] .body').first().should('have.css', 'stroke-width', '5px');
  });
});
