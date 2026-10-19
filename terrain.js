class TerrainGenerator {
    constructor() {
        this.cols = 0;
        this.rows = 0;
        this.grid = [];
        this.minHeight = Infinity;
        this.maxHeight = -Infinity;
        this.metersPerPixel = 30;
    }

    generateFromTIFF(elevationData, tiffWidth, tiffHeight, canvasWidth, canvasHeight, metersPerPixel = 30) {
        this.cols = canvasWidth;
        this.rows = canvasHeight;
        this.metersPerPixel = metersPerPixel;
        this.grid = new Array(this.cols);
        this.minHeight = Infinity;
        this.maxHeight = -Infinity;

        // Map the canvas grid cells to source TIFF pixels
        const scaleX = tiffWidth / this.cols;
        const scaleY = tiffHeight / this.rows;

        const cells = [];

        for (let x = 0; x < this.cols; x++) {
            this.grid[x] = new Array(this.rows);
            for (let y = 0; y < this.rows; y++) {
                const gx = x * scaleX;
                const gy = y * scaleY;
                const gxi = Math.floor(gx);
                const gyi = Math.floor(gy);

                // Clamp to edges
                const gxi1 = Math.min(gxi + 1, tiffWidth - 1);
                const gyi1 = Math.min(gyi + 1, tiffHeight - 1);

                const dx = gx - gxi;
                const dy = gy - gyi;

                // 4 surrounding pixels
                const c00 = elevationData[gyi * tiffWidth + gxi];
                const c10 = elevationData[gyi * tiffWidth + gxi1];
                const c01 = elevationData[gyi1 * tiffWidth + gxi];
                const c11 = elevationData[gyi1 * tiffWidth + gxi1];

                // Bilinear interpolation
                const c0 = c00 * (1 - dx) + c10 * dx;
                const c1 = c01 * (1 - dx) + c11 * dx;
                const elevation = c0 * (1 - dy) + c1 * dy;

                if (elevation < this.minHeight) this.minHeight = elevation;
                if (elevation > this.maxHeight) this.maxHeight = elevation;

                const cell = {
                    x: x,
                    y: y,
                    rawHeight: elevation,
                    height: 0,
                    isWater: false,
                    flowAcc: 1,
                    downstream: null
                };
                this.grid[x][y] = cell;
                cells.push(cell);
            }
        }

        // Normalize heights strictly between 0.0 and 1.0 for rendering colormap
        const heightRange = this.maxHeight - this.minHeight;
        if (heightRange > 0) {
            for (let i = 0; i < cells.length; i++) {
                cells[i].height = (cells[i].rawHeight - this.minHeight) / heightRange;
            }
        }

        // --- Fast D8 Flow Accumulation Hydrology ---
        // 1. Sort by height descending to ensure upstream is processed before downstream
        cells.sort((a, b) => b.rawHeight - a.rawHeight);

        const dirs = [
            { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
            { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 }
        ];

        // 2. Assign D8 flow pointers (steepest descent)
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            let maxDrop = 0;
            let target = null;

            for (const dir of dirs) {
                const nx = cell.x + dir.dx;
                const ny = cell.y + dir.dy;

                if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
                    const neighbor = this.grid[nx][ny];
                    const drop = cell.rawHeight - neighbor.rawHeight;
                    const dist = (dir.dx !== 0 && dir.dy !== 0) ? 1.4142 : 1.0;
                    const slope = drop / dist;

                    if (slope > maxDrop) {
                        maxDrop = slope;
                        target = neighbor;
                    }
                }
            }
            cell.downstream = target;
        }

        // 3. Accumulate Flow down the network
        let maxAcc = 0;
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.downstream) {
                cell.downstream.flowAcc += cell.flowAcc;
                if (cell.downstream.flowAcc > maxAcc) {
                    maxAcc = cell.downstream.flowAcc;
                }
            }
        }

        // 4. Extract Real Streams / Rivers
        // Calibrated threshold to detect primary river networks and water bodies
        const streamThreshold = Math.max(200, maxAcc * 0.015);
        for (let i = 0; i < cells.length; i++) {
            if (cells[i].flowAcc > streamThreshold) {
                cells[i].isWater = true;
                // Propagate water continuously downstream so streams have no dry gaps
                let curr = cells[i].downstream;
                while (curr && !curr.isWater) {
                    curr.isWater = true;
                    curr = curr.downstream;
                }
            }
        }
    }

    getCell(x, y) {
        if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
            return this.grid[x][y];
        }
        return null;
    }

    getSlopePercent(x1, y1, x2, y2) {
        const c1 = this.getCell(x1, y1);
        const c2 = this.getCell(x2, y2);
        if (!c1 || !c2) return 0;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distFactor = (dx !== 0 && dy !== 0) ? 1.4142 : 1.0;
        const distMeters = distFactor * this.metersPerPixel;
        const elevDiff = Math.abs(c2.rawHeight - c1.rawHeight);
        return (elevDiff / distMeters) * 100;
    }
}
