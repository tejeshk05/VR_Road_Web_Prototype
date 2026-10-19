class MinHeap {
    constructor() {
        this.heap = [];
    }
    push(item, priority) {
        this.heap.push({ item, priority });
        this.bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const end = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = end;
            this.sinkDown(0);
        }
        return min.item;
    }
    bubbleUp(n) {
        const element = this.heap[n];
        while (n > 0) {
            const parentN = Math.floor((n + 1) / 2) - 1;
            const parent = this.heap[parentN];
            if (element.priority >= parent.priority) break;
            this.heap[parentN] = element;
            this.heap[n] = parent;
            n = parentN;
        }
    }
    sinkDown(n) {
        const length = this.heap.length;
        const element = this.heap[n];
        while (true) {
            const child2N = (n + 1) * 2;
            const child1N = child2N - 1;
            let swap = null;
            let child1Priority;

            if (child1N < length) {
                const child1 = this.heap[child1N];
                child1Priority = child1.priority;
                if (child1Priority < element.priority) swap = child1N;
            }
            if (child2N < length) {
                const child2 = this.heap[child2N];
                if (child2.priority < (swap === null ? element.priority : child1Priority)) swap = child2N;
            }
            if (swap === null) break;
            this.heap[n] = this.heap[swap];
            this.heap[swap] = element;
            n = swap;
        }
    }
    isEmpty() { return this.heap.length === 0; }
}

class AStarPathfinder {
    constructor(terrainGenerator) {
        this.terrain = terrainGenerator;
    }

    heuristic(x, y, gx, gy, cellSizeMeters, roadCost) {
        const dx = Math.abs(x - gx);
        const dy = Math.abs(y - gy);
        // Octile distance for 8-connected grid
        const octile = Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
        return octile * cellSizeMeters * roadCost;
    }

    findPath(startPos, endPos, constraints) {
        const startNode = this.terrain.getCell(startPos.x, startPos.y);
        const endNode = this.terrain.getCell(endPos.x, endPos.y);

        if (!startNode || !endNode) {
            return { success: false, reason: "Invalid start or end coordinates." };
        }

        const cellSizeMeters = constraints.cellSizeMeters || this.terrain.metersPerPixel || 30;
        const maxSlope = constraints.maxSlope || 25;
        const maxBridgeSpan = constraints.maxBridgeSpan || 150;
        const maxBridges = constraints.maxBridges !== undefined ? constraints.maxBridges : 5;
        const roadCost = constraints.roadCost || 10;
        const bridgeCost = constraints.bridgeCost || 50;
        const budget = constraints.budget || 50000;
        const curvatureWeight = 0.25; // Civil engineering penalty for sharp angular changes

        // Priority queue
        const openSet = new MinHeap();
        const gScore = new Map();
        const cameFrom = new Map();

        // Start state setup
        const startIsWater = startNode.isWater;
        const startState = {
            x: startPos.x,
            y: startPos.y,
            isBridge: startIsWater,
            bridgeSpan: 0,
            bridgeCount: startIsWater ? 1 : 0,
            dirX: 0,
            dirY: 0
        };

        const startKey = `${startState.x},${startState.y},${startState.isBridge ? 1 : 0}`;
        gScore.set(startKey, 0);

        const initialH = this.heuristic(startPos.x, startPos.y, endPos.x, endPos.y, cellSizeMeters, roadCost);
        openSet.push(startState, initialH);

        const dirs = [
            { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
            { dx: 1, dy: 0 },  { dx: 1, dy: 1 },
            { dx: 0, dy: 1 },  { dx: -1, dy: 1 },
            { dx: -1, dy: 0 }, { dx: -1, dy: -1 }
        ];

        let iterations = 0;
        const maxIterations = 350000;

        // Diagnostic counters
        let countSlopeBlocked = 0;
        let countSpanExceeded = 0;
        let countBridgesExceeded = 0;
        let countBudgetExceeded = 0;
        let minUnreachedH = Infinity;

        while (!openSet.isEmpty()) {
            iterations++;
            if (iterations > maxIterations) {
                return {
                    success: false,
                    reason: "Search timed out. Try increasing Max Slope or Bridge Span limits."
                };
            }

            const current = openSet.pop();
            const currentKey = `${current.x},${current.y},${current.isBridge ? 1 : 0}`;
            const currentG = gScore.get(currentKey);

            // Goal check
            if (current.x === endPos.x && current.y === endPos.y) {
                return this.reconstructPath(cameFrom, currentKey, currentG, cellSizeMeters);
            }

            const currentCell = this.terrain.getCell(current.x, current.y);
            const currentH = this.heuristic(current.x, current.y, endPos.x, endPos.y, cellSizeMeters, roadCost);
            if (currentH < minUnreachedH) {
                minUnreachedH = currentH;
            }

            for (const dir of dirs) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;
                const neighbor = this.terrain.getCell(nx, ny);
                if (!neighbor) continue;

                const isDiag = dir.dx !== 0 && dir.dy !== 0;
                const stepDistMeters = (isDiag ? 1.4142 : 1.0) * cellSizeMeters;

                // Height difference & Slope percentage
                const heightDiff = neighbor.rawHeight - currentCell.rawHeight;
                const slopePercent = (Math.abs(heightDiff) / stepDistMeters) * 100;

                // Curvature / Transition angle penalty
                let turnFactor = 0;
                if (current.dirX !== 0 || current.dirY !== 0) {
                    const dot = current.dirX * dir.dx + current.dirY * dir.dy;
                    const magCur = (current.dirX !== 0 && current.dirY !== 0) ? 1.4142 : 1.0;
                    const magNext = isDiag ? 1.4142 : 1.0;
                    const cosTheta = dot / (magCur * magNext);

                    if (cosTheta > 0.85) {
                        turnFactor = 0;      // Straight
                    } else if (cosTheta > 0.3) {
                        turnFactor = 0.12;   // 45 degree turn
                    } else if (cosTheta > -0.3) {
                        turnFactor = 0.40;   // 90 degree turn
                    } else {
                        turnFactor = 1.20;   // Sharp turn / Hairpin
                    }
                }

                // ==========================================
                // Dynamic Decision: Road vs Bridge (Section 7)
                // ==========================================
                const candidates = [];

                // Check if crossing water directly or diagonally across corners
                let crossesWater = neighbor.isWater || currentCell.isWater;
                if (!crossesWater && isDiag) {
                    const cAdj1 = this.terrain.getCell(current.x + dir.dx, current.y);
                    const cAdj2 = this.terrain.getCell(current.x, current.y + dir.dy);
                    if ((cAdj1 && cAdj1.isWater) || (cAdj2 && cAdj2.isWater)) {
                        crossesWater = true;
                    }
                }

                // --- 1. ROAD OPTION ---
                // Valid strictly if NOT crossing water and within safe slope gradient
                const roadFeasible = !crossesWater && (slopePercent <= maxSlope);
                if (roadFeasible) {
                    // Earthwork grading cost penalty for steep slopes (Section 6)
                    const slopeRatio = slopePercent / maxSlope;
                    const gradingPenalty = Math.pow(slopeRatio, 1.8) * 0.8;
                    const roadSegmentCost = stepDistMeters * roadCost * (1 + gradingPenalty) * (1 + turnFactor * curvatureWeight);

                    candidates.push({
                        isBridge: false,
                        bridgeSpan: 0,
                        bridgeCount: current.bridgeCount,
                        cost: roadSegmentCost,
                        slope: slopePercent
                    });
                } else if (!crossesWater && slopePercent > maxSlope) {
                    countSlopeBlocked++;
                }

                // --- 2. BRIDGE OPTION ---
                // Evaluated when crossing rivers/water OR steep ravines where road grading is impossible/costly
                const needsBridge = crossesWater || (slopePercent > maxSlope * 0.5);
                if (needsBridge) {
                    let nextSpan = current.isBridge ? (current.bridgeSpan + stepDistMeters) : stepDistMeters;
                    let nextBridges = current.isBridge ? current.bridgeCount : (current.bridgeCount + 1);

                    let bridgeAllowed = true;
                    if (nextSpan > maxBridgeSpan) {
                        bridgeAllowed = false;
                        countSpanExceeded++;
                    }
                    if (nextBridges > maxBridges) {
                        bridgeAllowed = false;
                        countBridgesExceeded++;
                    }

                    if (bridgeAllowed) {
                        const bridgeSegmentCost = stepDistMeters * bridgeCost * (1 + turnFactor * curvatureWeight * 0.5);
                        candidates.push({
                            isBridge: true,
                            bridgeSpan: nextSpan,
                            bridgeCount: nextBridges,
                            cost: bridgeSegmentCost,
                            slope: 0 // Bridge spans flat/gentle across the depression
                        });
                    }
                }

                // Evaluate all feasible candidates
                for (const candidate of candidates) {
                    const tentativeG = currentG + candidate.cost;

                    if (tentativeG > budget) {
                        countBudgetExceeded++;
                        continue;
                    }

                    const nextKey = `${nx},${ny},${candidate.isBridge ? 1 : 0}`;
                    if (!gScore.has(nextKey) || tentativeG < gScore.get(nextKey)) {
                        gScore.set(nextKey, tentativeG);

                        cameFrom.set(nextKey, {
                            prevKey: currentKey,
                            x: nx,
                            y: ny,
                            isBridge: candidate.isBridge,
                            stepDist: stepDistMeters,
                            stepCost: candidate.cost,
                            slope: candidate.slope,
                            rawHeight: neighbor.rawHeight,
                            height: neighbor.height,
                            isWater: neighbor.isWater
                        });

                        const h = this.heuristic(nx, ny, endPos.x, endPos.y, cellSizeMeters, roadCost);
                        const f = tentativeG + h;

                        openSet.push({
                            x: nx,
                            y: ny,
                            isBridge: candidate.isBridge,
                            bridgeSpan: candidate.bridgeSpan,
                            bridgeCount: candidate.bridgeCount,
                            dirX: dir.dx,
                            dirY: dir.dy
                        }, f);
                    }
                }
            }
        }

        // Search completed with no path found - provide specific engineering diagnostic
        let failureReason = "No feasible path found.";
        if (countBudgetExceeded > 0) {
            failureReason = `Budget exceeded ($${budget.toLocaleString()}). Try increasing budget or reducing road/bridge costs.`;
        } else if (countSpanExceeded > 0 && countBridgesExceeded > 0) {
            failureReason = `Obstacle wider than Max Bridge Span (${maxBridgeSpan}m) and Max Bridges (${maxBridges}) reached.`;
        } else if (countSpanExceeded > 0) {
            failureReason = `River or valley span exceeds Max Bridge Span (${maxBridgeSpan}m). Increase bridge span.`;
        } else if (countBridgesExceeded > 0) {
            failureReason = `Allowed bridge count limit (${maxBridges}) reached. Increase Max Number of Bridges.`;
        } else if (countSlopeBlocked > 0) {
            failureReason = `Terrain slope exceeds Max Slope (${maxSlope}%) without available bridge span. Increase Max Slope.`;
        }

        return {
            success: false,
            reason: failureReason
        };
    }

    reconstructPath(cameFrom, endKey, totalCost, cellSizeMeters) {
        const path = [];
        let currKey = endKey;

        let totalRoadMeters = 0;
        let totalBridgeMeters = 0;
        let totalRoadCost = 0;
        let totalBridgeCost = 0;
        let maxSlopeSeen = 0;

        let bridgesCount = 0;
        let currentlyInBridge = false;

        while (cameFrom.has(currKey)) {
            const entry = cameFrom.get(currKey);

            path.unshift({
                x: entry.x,
                y: entry.y,
                isBridge: entry.isBridge,
                rawHeight: entry.rawHeight,
                height: entry.height,
                isWater: entry.isWater,
                slope: entry.slope
            });

            if (entry.isBridge) {
                totalBridgeMeters += entry.stepDist;
                totalBridgeCost += entry.stepCost;
                if (!currentlyInBridge) {
                    bridgesCount++;
                    currentlyInBridge = true;
                }
            } else {
                totalRoadMeters += entry.stepDist;
                totalRoadCost += entry.stepCost;
                currentlyInBridge = false;
                if (entry.slope > maxSlopeSeen) {
                    maxSlopeSeen = entry.slope;
                }
            }

            currKey = entry.prevKey;
        }

        // Add start point if path exists
        if (path.length > 0) {
            const first = path[0];
            path.unshift({
                x: first.x,
                y: first.y,
                isBridge: first.isBridge,
                rawHeight: first.rawHeight,
                height: first.height,
                isWater: first.isWater,
                slope: 0
            });
        }

        return {
            success: true,
            path: path,
            totalCost: totalCost,
            roadCost: Math.round(totalRoadCost),
            bridgeCost: Math.round(totalBridgeCost),
            roadMeters: Math.round(totalRoadMeters),
            bridgeMeters: Math.round(totalBridgeMeters),
            bridgeCount: bridgesCount,
            maxSlope: parseFloat(maxSlopeSeen.toFixed(1))
        };
    }
}
