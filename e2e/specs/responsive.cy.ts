import { drawStarterScene, openEditor, shapes } from '../support/editor';

describe('small screens', () => {
  [360, 390, 768].forEach((width) => {
    it(`fits ${width} px wide without a horizontal scroll bar`, () => {
      cy.viewport(width, 800);
      openEditor();
      drawStarterScene();
      shapes().should('have.length', 2);
      cy.document().then((document) => {
        const root = document.documentElement;
        expect(root.scrollWidth, 'document width').to.be.at.most(root.clientWidth);
      });
      cy.get('st-devtools').scrollIntoView().should('be.visible');
      cy.get('st-branch-tree').should('be.visible');
    });
  });

  it('keeps the canvas in proportion', () => {
    cy.viewport(390, 800);
    openEditor();
    cy.get('svg.surface').then(($svg) => {
      const box = $svg[0]?.getBoundingClientRect() ?? new DOMRect();
      expect(box.width / box.height).to.be.closeTo(960 / 600, 0.02);
    });
  });
});
