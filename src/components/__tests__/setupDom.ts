/**
 * jsdom polyfills for modules that pdfjs-dist touches at import time.
 * The completion-mechanics test never parses a PDF — pdfjs just has to
 * survive being loaded.
 */

const g = globalThis as any;

if (typeof g.DOMMatrix === 'undefined') {
  class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    is2D = true;
    isIdentity = true;
    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
        this.is2D = this.b === 0 && this.c === 0;
      }
    }
    inverse() {
      return new DOMMatrixStub();
    }
    inverseSelf() {
      return this;
    }
    multiplySelf() {
      return this;
    }
    transform(p: any) {
      return p;
    }
    translate() {
      return this;
    }
    scale() {
      return this;
    }
    toString() {
      return 'matrix(1, 0, 0, 1, 0, 0)';
    }
  }
  g.DOMMatrix = DOMMatrixStub;
}

if (typeof g.Path2D === 'undefined') {
  class Path2DStub {
    constructor(_d?: string) {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    fill() {}
    stroke() {}
  }
  g.Path2D = Path2DStub;
}

export {};
