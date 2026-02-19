/**
 * ChessBoard - Renders and manages the interactive chess board UI
 * Handles piece rendering, click/drag selection, legal move highlighting,
 * and board orientation based on player color.
 */
class ChessBoard {
  constructor(boardEl, options = {}) {
    this.boardEl = boardEl;
    this.onMove = options.onMove || (() => {});
    this.onPromotionNeeded = options.onPromotionNeeded || (() => {});
    this.orientation = options.orientation || 'white'; // 'white' = white at bottom
    this.interactive = options.interactive !== false;

    this.squares = [];
    this.selectedSquare = null;
    this.legalMoves = {};
    this.lastMove = null;
    this.checkSquare = null;
    this.pendingPromotion = null;

    this.pieceMap = {
      K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn',
      k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
    };

    this.buildBoard();
  }

  buildBoard() {
    this.boardEl.innerHTML = '';
    this.squares = [];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const displayRow = this.orientation === 'white' ? row : 7 - row;
        const displayCol = this.orientation === 'white' ? col : 7 - col;

        const file = String.fromCharCode(97 + displayCol);
        const rank = 8 - displayRow;
        const squareName = file + rank;

        const isLight = (displayRow + displayCol) % 2 === 0;
        const sq = document.createElement('div');
        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.dataset.square = squareName;

        // Rank labels on left column
        if (col === 0) {
          const rl = document.createElement('span');
          rl.className = 'rank-label';
          rl.textContent = rank;
          sq.appendChild(rl);
        }

        // File labels on bottom row
        if (row === 7) {
          const fl = document.createElement('span');
          fl.className = 'file-label';
          fl.textContent = file;
          sq.appendChild(fl);
        }

        sq.addEventListener('click', () => this.handleSquareClick(squareName));

        this.boardEl.appendChild(sq);
        this.squares.push({ el: sq, name: squareName, row: displayRow, col: displayCol });
      }
    }
  }

  setOrientation(color) {
    this.orientation = color;
    this.buildBoard();
  }

  getSquareEl(name) {
    const sq = this.squares.find(s => s.name === name);
    return sq ? sq.el : null;
  }

  /**
   * Update the board display from a FEN string
   */
  setPosition(fen) {
    // Clear all pieces
    for (const sq of this.squares) {
      const existing = sq.el.querySelector('.piece-img');
      if (existing) existing.remove();
    }

    // Parse FEN - only need piece placement (first part)
    const placement = fen.split(' ')[0];
    const rows = placement.split('/');

    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          col += parseInt(ch);
        } else {
          const file = String.fromCharCode(97 + col);
          const rank = 8 - r;
          const squareName = file + rank;
          const color = ch === ch.toUpperCase() ? 'white' : 'black';
          const piece = this.pieceMap[ch];

          this.placePiece(squareName, color, piece);
          col++;
        }
      }
    }
  }

  placePiece(squareName, color, piece) {
    const sqEl = this.getSquareEl(squareName);
    if (!sqEl) return;

    const img = document.createElement('img');
    img.className = 'piece-img';
    img.src = `/assets/pieces/${color}_${piece}.svg`;
    img.alt = `${color} ${piece}`;
    img.draggable = false;
    sqEl.appendChild(img);
  }

  setLegalMoves(moves) {
    this.legalMoves = moves || {};
  }

  setInteractive(interactive) {
    this.interactive = interactive;
  }

  handleSquareClick(squareName) {
    if (!this.interactive) return;

    if (this.pendingPromotion) return; // Waiting for promotion choice

    if (this.selectedSquare) {
      // Try to move
      const fromMoves = this.legalMoves[this.selectedSquare] || [];
      if (fromMoves.includes(squareName)) {
        // Check if this is a pawn promotion
        if (this.isPromotion(this.selectedSquare, squareName)) {
          this.pendingPromotion = { from: this.selectedSquare, to: squareName };
          this.onPromotionNeeded(this.selectedSquare, squareName);
        } else {
          this.onMove(this.selectedSquare, squareName, null);
        }
        this.clearSelection();
        return;
      }

      // Clicking on own piece - reselect
      if (this.legalMoves[squareName]) {
        this.selectSquare(squareName);
        return;
      }

      // Click elsewhere - deselect
      this.clearSelection();
      return;
    }

    // No selection yet - select if has legal moves
    if (this.legalMoves[squareName] && this.legalMoves[squareName].length > 0) {
      this.selectSquare(squareName);
    }
  }

  isPromotion(from, to) {
    const fromRank = parseInt(from[1]);
    const toRank = parseInt(to[1]);
    const sqEl = this.getSquareEl(from);
    const piece = sqEl?.querySelector('.piece-img');
    if (!piece) return false;
    const alt = piece.alt || '';
    const isPawn = alt.includes('pawn');
    return isPawn && (toRank === 8 || toRank === 1);
  }

  resolvePromotion(piece) {
    if (!this.pendingPromotion) return;
    const { from, to } = this.pendingPromotion;
    this.pendingPromotion = null;
    this.onMove(from, to, piece);
  }

  cancelPromotion() {
    this.pendingPromotion = null;
  }

  selectSquare(squareName) {
    this.clearHighlights();
    this.selectedSquare = squareName;

    const sqEl = this.getSquareEl(squareName);
    if (sqEl) sqEl.classList.add('selected');

    // Highlight legal moves
    const moves = this.legalMoves[squareName] || [];
    for (const target of moves) {
      const targetEl = this.getSquareEl(target);
      if (!targetEl) continue;
      const hasPiece = targetEl.querySelector('.piece-img');
      targetEl.classList.add(hasPiece ? 'legal-capture' : 'legal-move');
      targetEl.classList.add('clickable');
    }
  }

  clearSelection() {
    this.selectedSquare = null;
    this.clearHighlights();
  }

  clearHighlights() {
    for (const sq of this.squares) {
      sq.el.classList.remove('selected', 'legal-move', 'legal-capture', 'clickable');
    }
    // Re-apply last move and check highlights
    this.applyLastMoveHighlight();
    this.applyCheckHighlight();
  }

  setLastMove(from, to) {
    this.lastMove = { from, to };
    this.applyLastMoveHighlight();
  }

  applyLastMoveHighlight() {
    // Clear previous
    for (const sq of this.squares) {
      sq.el.classList.remove('last-from', 'last-to');
    }
    if (this.lastMove) {
      const fromEl = this.getSquareEl(this.lastMove.from);
      const toEl = this.getSquareEl(this.lastMove.to);
      if (fromEl) fromEl.classList.add('last-from');
      if (toEl) toEl.classList.add('last-to');
    }
  }

  setCheck(squareName) {
    this.checkSquare = squareName;
    this.applyCheckHighlight();
  }

  clearCheck() {
    this.checkSquare = null;
    for (const sq of this.squares) {
      sq.el.classList.remove('in-check');
    }
  }

  applyCheckHighlight() {
    for (const sq of this.squares) {
      sq.el.classList.remove('in-check');
    }
    if (this.checkSquare) {
      const el = this.getSquareEl(this.checkSquare);
      if (el) el.classList.add('in-check');
    }
  }

  /**
   * Find king square from the current board display
   */
  findKing(color) {
    for (const sq of this.squares) {
      const img = sq.el.querySelector('.piece-img');
      if (img && img.alt === `${color} king`) {
        return sq.name;
      }
    }
    return null;
  }
}
