const canvas = document.getElementById('terrainCanvas');
const ctx = canvas.getContext('2d');

let cellSize = 1;

const terrain = new TerrainGenerator();
const astar = new AStarPathfinder(terrain);

let startPoint = null;
let endPoint = null;
let currentPath = null;

// UI Elements mapping
const ui = {
    demUpload: document.getElementById('demUpload'),
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    resetBtn: document.getElementById('resetBtn'),
    scaleInfo: document.getElementById('scaleInfo'),

    roadCost: document.getElementById('roadCost'),
    roadCostVal: document.getElementById('roadCostVal'),
    bridgeCost: document.getElementById('bridgeCost'),
    bridgeCostVal: document.getElementById('bridgeCostVal'),
    budget: document.getElementById('budget'),
    budgetVal: document.getElementById('budgetVal'),
    maxSlope: document.getElementById('maxSlope'),
    maxSlopeVal: document.getElementById('maxSlopeVal'),
    maxBridge: document.getElementById('maxBridge'),
    maxBridgeVal: document.getElementById('maxBridgeVal'),
    maxBridges: document.getElementById('maxBridges'),
    maxBridgesVal: document.getElementById('maxBridgesVal'),
    maxBridgesDisplay: document.getElementById('maxBridgesDisplay'),

    status: document.getElementById('status'),
    pathCost: document.getElementById('pathCost'),
    roadCostTotal: document.getElementById('roadCostTotal'),
    bridgeCostTotal: document.getElementById('bridgeCostTotal'),
    roadLength: document.getElementById('roadLength'),
    bridgeLength: document.getElementById('bridgeLength'),
    bridgeCount: document.getElementById('bridgeCount'),
    routeMaxSlope: document.getElementById('routeMaxSlope')
};

// Update value displays and recalculate on input
document.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', (e) => {
        const id = e.target.id;
        const val = e.target.value;
        const valSpan = document.getElementById(id + 'Val');

        if (id === 'budget') {
            valSpan.innerText = Number(val).toLocaleString();
        } else {
            valSpan.innerText = val;
        }

        if (id === 'maxBridges' && ui.maxBridgesDisplay) {
            ui.maxBridgesDisplay.innerText = val;
        }

        if (['roadCost', 'bridgeCost', 'budget', 'maxSlope', 'maxBridge', 'maxBridges'].includes(id)) {
            if (startPoint && endPoint) {
                calculatePath();
            }
        }
    });
});

// Common GeoTIFF loader & parser
async function parseAndRenderTIFF(arrayBuffer, sourceName = "DEM") {
    ui.status.innerText = `Parsing GeoTIFF (${sourceName})...`;
    ui.status.style.color = "#38bdf8";

    try {
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasters = await image.readRasters();

        const elevationData = rasters[0];
        const width = image.getWidth();
        const height = image.getHeight();

        // Dynamically adjust canvas dimensions to maintain source TIFF aspect ratio
        const targetWidth = 800;
        const targetHeight = Math.max(300, Math.min(800, Math.round(targetWidth * (height / width))));
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // Calculate real-world physical scale (meters per pixel)
        let detectedMetersPerPixel = 30; // standard default
        try {
            const bbox = image.getBoundingBox();
            if (bbox && bbox.length === 4) {
                const [minX, minY, maxX, maxY] = bbox;
                if (Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90) {
                    // WGS84 Geographic degrees
                    const midLat = ((minY + maxY) / 2) * (Math.PI / 180);
                    const spanXDeg = Math.abs(maxX - minX);
                    const spanYDeg = Math.abs(maxY - minY);
                    const widthMeters = spanXDeg * 111320 * Math.cos(midLat);
                    const heightMeters = spanYDeg * 111320;
                    detectedMetersPerPixel = Math.round((widthMeters / canvas.width + heightMeters / canvas.height) / 2);
                } else if (Math.abs(maxX - minX) > 1000) {
                    // Projected UTM coordinates in meters
                    const widthMeters = Math.abs(maxX - minX);
                    const heightMeters = Math.abs(maxY - minY);
                    detectedMetersPerPixel = Math.round((widthMeters / canvas.width + heightMeters / canvas.height) / 2);
                }
            }
        } catch (bboxErr) {
            console.warn("Could not extract bounding box, defaulting to 30m/pixel:", bboxErr);
        }

        if (detectedMetersPerPixel < 1) detectedMetersPerPixel = 1;

        const totalWidthKm = ((detectedMetersPerPixel * canvas.width) / 1000).toFixed(1);
        const totalHeightKm = ((detectedMetersPerPixel * canvas.height) / 1000).toFixed(1);
        ui.scaleInfo.innerText = `Scale: ~${detectedMetersPerPixel} m/px (${totalWidthKm} × ${totalHeightKm} km)`;

        ui.status.innerText = "Computing River Hydrology (D8 Flow)...";

        setTimeout(() => {
            terrain.generateFromTIFF(elevationData, width, height, canvas.width, canvas.height, detectedMetersPerPixel);

            startPoint = null;
            endPoint = null;
            currentPath = null;

            ui.status.innerText = "Terrain Ready. Click map to place Start (A).";
            ui.status.style.color = "#38bdf8";
            resetMetrics();
            draw();
        }, 50);

    } catch (err) {
        console.error(err);
        ui.status.innerText = "Error parsing TIFF file. Please check file format.";
        ui.status.style.color = "#ef4444";
    }
}

// Upload custom file handler
ui.demUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    await parseAndRenderTIFF(arrayBuffer, file.name);
});

// Load sample DEM function
async function loadSampleDEM() {
    ui.status.innerText = "Fetching output_SRTMGL3.tif...";
    ui.status.style.color = "#38bdf8";
    try {
        const resp = await fetch('./output_SRTMGL3.tif');
        if (!resp.ok) throw new Error("Could not find output_SRTMGL3.tif");
        const buffer = await resp.arrayBuffer();
        await parseAndRenderTIFF(buffer, "output_SRTMGL3.tif");
    } catch (err) {
        console.error(err);
        ui.status.innerText = "Could not load sample DEM. Upload your own .tif above.";
        ui.status.style.color = "#ef4444";
    }
}
window.loadSampleDEM = loadSampleDEM;

// Reset Points function
function resetPoints() {
    startPoint = null;
    endPoint = null;
    currentPath = null;
    resetMetrics();
    if (terrain.minHeight !== Infinity) {
        ui.status.innerText = "Points cleared. Click map to place Start (A).";
        ui.status.style.color = "#38bdf8";
    }
    draw();
}
window.resetPoints = resetPoints;

if (ui.loadSampleBtn) {
    ui.loadSampleBtn.addEventListener('click', loadSampleDEM);
}
if (ui.resetBtn) {
    ui.resetBtn.addEventListener('click', resetPoints);
}

function resetMetrics() {
    ui.pathCost.innerText = "0.00";
    ui.roadCostTotal.innerText = "0.00";
    ui.bridgeCostTotal.innerText = "0.00";
    ui.roadLength.innerText = "0";
    ui.bridgeLength.innerText = "0";
    ui.bridgeCount.innerText = "0";
    ui.routeMaxSlope.innerText = "0.0";
}

// Canvas Click handler
canvas.addEventListener('click', (e) => {
    if (terrain.minHeight === Infinity) {
        alert("Please upload a .tif DEM file or click 'Load Sample DEM' first!");
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const gridX = Math.max(0, Math.min(x, canvas.width - 1));
    const gridY = Math.max(0, Math.min(y, canvas.height - 1));

    if (!startPoint) {
        startPoint = { x: gridX, y: gridY };
        endPoint = null;
        currentPath = null;
        ui.status.innerText = "Start (A) placed. Click to place End (B).";
        ui.status.style.color = "#38bdf8";
        resetMetrics();
    } else if (!endPoint) {
        endPoint = { x: gridX, y: gridY };
        calculatePath();
    } else {
        // Reset and start new route from this point
        startPoint = { x: gridX, y: gridY };
        endPoint = null;
        currentPath = null;
        ui.status.innerText = "Start (A) placed. Click to place End (B).";
        ui.status.style.color = "#38bdf8";
        resetMetrics();
    }
    draw();
});

function init() {
    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Upload a GeoTIFF (.tif) or click 'Load Sample DEM' to begin", canvas.width / 2, canvas.height / 2);
}

function getConstraints() {
    return {
        roadCost: parseFloat(ui.roadCost.value),
        bridgeCost: parseFloat(ui.bridgeCost.value),
        budget: parseFloat(ui.budget.value),
        maxSlope: parseFloat(ui.maxSlope.value),
        maxBridgeSpan: parseFloat(ui.maxBridge.value),
        maxBridges: parseInt(ui.maxBridges.value, 10),
        cellSizeMeters: terrain.metersPerPixel || 30
    };
}

function calculatePath() {
    if (!startPoint || !endPoint) return;

    ui.status.innerText = "Optimizing Route (Civil Engineering Constraints)...";
    ui.status.style.color = "#fde047";

    setTimeout(() => {
        const constraints = getConstraints();
        const result = astar.findPath(startPoint, endPosToGoal(endPoint), constraints);

        if (result.success) {
            currentPath = result.path;
            ui.status.innerText = "Feasible Route Found! (Within Budget & Limits)";
            ui.status.style.color = "#4ade80";

            ui.pathCost.innerText = result.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            ui.roadCostTotal.innerText = result.roadCost.toLocaleString();
            ui.bridgeCostTotal.innerText = result.bridgeCost.toLocaleString();
            ui.roadLength.innerText = result.roadMeters.toLocaleString();
            ui.bridgeLength.innerText = result.bridgeMeters.toLocaleString();
            ui.bridgeCount.innerText = result.bridgeCount;
            ui.routeMaxSlope.innerText = result.maxSlope.toFixed(1);
        } else {
            currentPath = null;
            ui.status.innerText = "Failed: " + result.reason;
            ui.status.style.color = "#ef4444";
            resetMetrics();
        }
        draw();
    }, 40);
}

function endPosToGoal(pt) {
    return { x: pt.x, y: pt.y };
}

// Matplotlib 'terrain' colormap approximation
function getTerrainColor(v) {
    const stops = [
        { v: 0.00, r: 46,  g: 139, b: 87 },   // Lowland Sea Green
        { v: 0.22, r: 143, g: 188, b: 143 },  // Grassland Dark Sea Green
        { v: 0.45, r: 222, g: 184, b: 135 },  // Hills Burlywood
        { v: 0.70, r: 160, g: 82,  b: 45 },   // Steep Sienna Brown
        { v: 0.88, r: 180, g: 180, b: 180 },  // Rocky Gray
        { v: 1.00, r: 245, g: 245, b: 250 }   // High Snow Peaks White
    ];

    let i = 0;
    while (i < stops.length - 1 && v > stops[i + 1].v) { i++; }
    if (i === stops.length - 1) return stops[i];

    const s1 = stops[i];
    const s2 = stops[i + 1];
    const t = (v - s1.v) / (s2.v - s1.v);

    return {
        r: Math.round(s1.r + t * (s2.r - s1.r)),
        g: Math.round(s1.g + t * (s2.g - s1.g)),
        b: Math.round(s1.b + t * (s2.b - s1.b))
    };
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (terrain.cols === 0 || terrain.rows === 0) {
        init();
        return;
    }

    // Fast high-res rendering using ImageData
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    for (let x = 0; x < canvas.width; x++) {
        for (let y = 0; y < canvas.height; y++) {
            const cell = terrain.getCell(x, y);
            if (!cell) continue;

            const idx = (y * canvas.width + x) * 4;

            if (cell.isWater) {
                // Vibrant Cyan-Blue for drainage river channels
                data[idx] = 0;
                data[idx + 1] = 229;
                data[idx + 2] = 255;
                data[idx + 3] = 255;
            } else {
                const color = getTerrainColor(cell.height);
                // Subtle hillshading pop
                const shadow = 0.88 + cell.height * 0.22;
                data[idx] = Math.min(255, Math.round(color.r * shadow));
                data[idx + 1] = Math.min(255, Math.round(color.g * shadow));
                data[idx + 2] = Math.min(255, Math.round(color.b * shadow));
                data[idx + 3] = 255;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw Route Paths
    if (currentPath && currentPath.length > 1) {
        // 1. Dark background outline along entire path
        ctx.beginPath();
        ctx.moveTo(currentPath[0].x, currentPath[0].y);
        for (let i = 1; i < currentPath.length; i++) {
            ctx.lineTo(currentPath[i].x, currentPath[i].y);
        }
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // 2. Draw Road segments in Solid Bright Yellow
        for (let i = 1; i < currentPath.length; i++) {
            const p1 = currentPath[i - 1];
            const p2 = currentPath[i];
            if (!p2.isBridge) {
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = '#ffeb3b';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        }

        // 3. Draw Bridge segments in Vivid Orange/Red with deck markings
        for (let i = 1; i < currentPath.length; i++) {
            const p1 = currentPath[i - 1];
            const p2 = currentPath[i];
            if (p1.isBridge || p2.isBridge) {
                // Bridge deck base
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = '#ff3d00';
                ctx.lineWidth = 5.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();

                // Bridge dashed deck centerline
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.stroke();
                ctx.setLineDash([]); // Reset dash
            }
        }
    }

    // Draw Marker: Start Point (A)
    if (startPoint) {
        drawPin(startPoint.x, startPoint.y, '#22c55e', 'A');
    }

    // Draw Marker: End Point (B)
    if (endPoint) {
        drawPin(endPoint.x, endPoint.y, '#ef4444', 'B');
    }
}

function drawPin(x, y, color, label) {
    ctx.save();
    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Pin circle
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pin Label (A or B)
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);

    ctx.restore();
}

init();
