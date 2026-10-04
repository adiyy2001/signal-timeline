import {
  autosaveCount,
  connectors,
  draw,
  drawStarterScene,
  drag,
  openEditor,
  pickTool,
  redo,
  shapes,
  treeItems,
  undo,
} from '../support/editor';

describe('the vector editor', () => {
  beforeEach(() => {
    openEditor();
  });

  it('starts with an empty canvas and one history entry', () => {
    shapes().should('have.length', 0);
    treeItems().should('have.length', 1);
    cy.contains('Pick a tool and drag here').should('exist');
  });

  it('draws a rectangle, an ellipse and a connector, one history entry each', () => {
    drawStarterScene();
    shapes().should('have.length', 2);
    shapes()
      .first()
      .should('have.attr', 'aria-label')
      .and('match', /^Rectangle 1, sky/);
    shapes()
      .last()
      .should('have.attr', 'aria-label')
      .and('match', /^Ellipse 1, mint/);
    connectors().should('have.length', 1);
    connectors()
      .first()
      .should('have.attr', 'aria-label', 'Connector from Rectangle 1 to Ellipse 1');
    treeItems().should('have.length', 4);
    treeItems().last().should('have.attr', 'aria-selected', 'true');
  });

  it('moves a shape with a drag as one entry', () => {
    draw('Rectangle', [80, 120], [260, 220]);
    treeItems().should('have.length', 2);
    pickTool('Select');
    drag([170, 170], [370, 270]);
    treeItems().should('have.length', 3);
    shapes().first().should('have.attr', 'aria-label').and('contain', 'at 280, 220');
    undo();
    shapes().first().should('have.attr', 'aria-label').and('contain', 'at 80, 120');
  });

  it('resizes a shape from its corner handle', () => {
    draw('Rectangle', [80, 120], [260, 220]);
    cy.get('[data-corner="se"]').then(($handle) => {
      const box = $handle[0]?.getBoundingClientRect() ?? new DOMRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const options = { button: 0, eventConstructor: 'PointerEvent', force: true };
      cy.get('[data-corner="se"]').trigger('pointerdown', { ...options, clientX: x, clientY: y });
      cy.get('svg.surface')
        .trigger('pointermove', { ...options, clientX: x + 40, clientY: y + 30 })
        .trigger('pointerup', { ...options, clientX: x + 40, clientY: y + 30 });
    });
    treeItems().should('have.length', 3);
    cy.get('[aria-label^="Resize Rectangle 1"]').should('exist');
    shapes()
      .first()
      .should('have.attr', 'aria-label')
      .and('match', /, 2\d\d by 1\d\d at 80, 120$/);
  });

  it('recolors a shape from the inspector', () => {
    draw('Ellipse', [300, 300], [440, 380]);
    cy.contains('button', 'rose').click();
    shapes().first().should('have.attr', 'aria-label').and('contain', 'rose');
    cy.get('[aria-label^="Recolor Ellipse 1"]').should('exist');
  });

  it('deletes a shape together with its connector as one entry', () => {
    drawStarterScene();
    connectors().should('have.length', 1);
    shapes().first().focus();
    cy.press(Cypress.Keyboard.Keys.DELETE);
    shapes().should('have.length', 1);
    connectors().should('have.length', 0);
    treeItems()
      .last()
      .should('have.attr', 'aria-label')
      .and('contain', 'Delete Rectangle 1 and 1 connector');
    undo();
    shapes().should('have.length', 2);
    connectors().should('have.length', 1);
  });

  it('undoes and redoes with the keyboard shortcuts and the buttons', () => {
    drawStarterScene();
    undo();
    connectors().should('have.length', 0);
    undo();
    shapes().should('have.length', 1);
    redo();
    shapes().should('have.length', 2);
    cy.contains('button', /^\s*Undo/).click();
    shapes().should('have.length', 1);
    cy.contains('button', /^\s*Redo/).click();
    shapes().should('have.length', 2);
  });

  it('branches when a change follows an undo and jumps between the branches', () => {
    drawStarterScene();
    undo();
    draw('Rectangle', [400, 380], [560, 470]);
    shapes().should('have.length', 3);
    connectors().should('have.length', 0);
    treeItems().should('have.length', 5);
    cy.get('st-branch-tree [role="treeitem"][aria-setsize="2"]').should('have.length', 2);

    cy.get('st-branch-tree [role="treeitem"][aria-label^="Add connector"]').click();
    connectors().should('have.length', 1);
    shapes().should('have.length', 2);

    cy.get('st-branch-tree [role="treeitem"][aria-label^="Add Rectangle 2"]').click();
    connectors().should('have.length', 0);
    shapes().should('have.length', 3);
  });

  it('scrubs the timeline with the keyboard', () => {
    drawStarterScene();
    cy.get('st-timeline-scrubber input[type="range"]').focus();
    cy.press(Cypress.Keyboard.Keys.LEFT);
    connectors().should('have.length', 0);
    cy.press(Cypress.Keyboard.Keys.LEFT);
    shapes().should('have.length', 1);
    cy.press(Cypress.Keyboard.Keys.HOME);
    shapes().should('have.length', 0);
    cy.press(Cypress.Keyboard.Keys.END);
    shapes().should('have.length', 2);
    connectors().should('have.length', 1);
  });

  it('moves through the tree with the arrow keys and jumps with Enter', () => {
    drawStarterScene();
    treeItems().should('have.length', 4);
    treeItems().last().focus();
    cy.press(Cypress.Keyboard.Keys.UP);
    cy.focused().should('have.attr', 'aria-label').and('contain', 'Add Ellipse 1');
    cy.press(Cypress.Keyboard.Keys.ENTER);
    connectors().should('have.length', 0);
    shapes().should('have.length', 2);
    cy.press(Cypress.Keyboard.Keys.HOME);
    cy.press(Cypress.Keyboard.Keys.ENTER);
    shapes().should('have.length', 0);
  });

  it('does not count undo, redo or a jump as an autosave', () => {
    drawStarterScene();
    autosaveCount().should('have.text', '3');
    undo();
    undo();
    redo();
    autosaveCount().should('have.text', '3');
    cy.get('st-branch-tree [role="treeitem"]').first().click();
    shapes().should('have.length', 0);
    autosaveCount().should('have.text', '3');
    draw('Rectangle', [80, 120], [260, 220]);
    autosaveCount().should('have.text', '4');
  });

  it('keeps the drawing and the whole history after a reload', () => {
    drawStarterScene();
    undo();
    draw('Rectangle', [400, 380], [560, 470]);
    cy.reload();
    shapes().should('have.length', 3);
    treeItems().should('have.length', 5);
    cy.get('st-branch-tree [role="treeitem"][aria-setsize="2"]').should('have.length', 2);
    undo();
    shapes().should('have.length', 2);
    cy.get('st-branch-tree [role="treeitem"][aria-label^="Add connector"]').click();
    connectors().should('have.length', 1);
  });

  it('clears the history and keeps the drawing', () => {
    drawStarterScene();
    cy.contains('button', 'Clear history').click();
    treeItems().should('have.length', 1);
    shapes().should('have.length', 2);
    cy.contains('button', 'Clear history').should('be.disabled');
  });
});
