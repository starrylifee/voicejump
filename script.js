const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game constants
const GRAVITY = 0.5;
const GROUND_Y = 400;
const CHICKEN_X = 100;
const INITIAL_SPEED = 5;
const JUMP_FORCE_MULTIPLIER = 35;
const DEFAULT_SENSITIVITY = 0.18;

// Game state
let score = 0;
let gameActive = false;
let speed = INITIAL_SPEED;
let obstacles = [];
let nextObstacleTimer = 0;
let obstacleBurst = 0;
let animationId;
let clouds = [];
let particles = [];
let gameStartTime = 0;
let elapsedSeconds = 0;
let sensitivityThreshold = DEFAULT_SENSITIVITY;
let previewAnimationId;
let micTestActive = false;

// Audio variables
let audioContext;
let analyser;
let microphone;
let dataArray;
let currentVolume = 0;

// Chicken object
const chicken = {
    x: CHICKEN_X,
    y: GROUND_Y - 40,
    width: 40,
    height: 40,
    vy: 0,
    isJumping: false,
    mouthOpen: 0,
    jumpsRemaining: 2,
    jumpReady: true,
    isFallingIntoHole: false,

    draw() {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);

        // Tilt based on velocity
        const tilt = Math.min(Math.max(this.vy * 0.05, -0.3), 0.3);
        ctx.rotate(tilt);

        // Body
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Comb
        ctx.fillStyle = '#ff4757';
        ctx.beginPath();
        ctx.moveTo(-5, -15);
        ctx.quadraticCurveTo(0, -25, 5, -15);
        ctx.fill();

        // Beak / Mouth
        ctx.fillStyle = '#ffa502';
        if (this.mouthOpen > 0) {
            ctx.beginPath();
            ctx.moveTo(15, -2);
            ctx.lineTo(25, -2 - this.mouthOpen * 15);
            ctx.lineTo(25, 6 + this.mouthOpen * 15);
            ctx.lineTo(15, 6);
            ctx.fill();
            this.mouthOpen -= 0.05;
        } else {
            ctx.beginPath();
            ctx.moveTo(15, -2);
            ctx.lineTo(25, 2);
            ctx.lineTo(15, 6);
            ctx.closePath();
            ctx.fill();
        }

        // Eye
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(8, -5, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Wing
        ctx.fillStyle = '#f1f2f6';
        ctx.beginPath();
        ctx.ellipse(-5, 2, 10, 6, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    },

    update() {
        this.y += this.vy;

        // If already falling into a hole, just keep falling
        if (this.isFallingIntoHole) {
            this.vy += GRAVITY;
            if (this.y > canvas.height) {
                endGame();
            }
            return;
        }

        // Check if chicken is over a hole
        let overHole = false;
        for (let obs of obstacles) {
            if (obs.type === 'hole' &&
                this.x + this.width / 2 > obs.x &&
                this.x + this.width / 2 < obs.x + obs.width) {
                overHole = true;
                break;
            }
        }

        if (this.y < GROUND_Y - this.height) {
            this.vy += GRAVITY;
            this.isJumping = true;
        } else if (!overHole) {
            this.y = GROUND_Y - this.height;
            this.vy = 0;
            this.isJumping = false;
            this.jumpsRemaining = 2; // Reset jumps on ground
        } else {
            // Over hole and at/below ground level: fall!
            this.isFallingIntoHole = true; // Set state so it can't escape
            this.vy += GRAVITY;
            this.isJumping = true;
        }
    },

    jump(volume) {
        // Can't jump if already falling into a hole
        if (this.isFallingIntoHole) return;

        if (this.jumpsRemaining > 0 && this.jumpReady) {
            const force = Math.min(volume * JUMP_FORCE_MULTIPLIER, 26);
            this.vy = -force;
            this.mouthOpen = volume;
            this.jumpsRemaining--;
            this.jumpReady = false; // Prevent continuous jump from one sound peak
            createJumpParticles();
        }
    }
};

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * -3 - 1;
        this.color = color;
        this.life = 1;
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.speedY += 0.1;
        this.life -= 0.02;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Obstacle {
    constructor(type) {
        this.x = canvas.width;
        this.type = type;

        if (type === 'block') {
            this.width = 35 + Math.random() * 95;
            this.height = 30 + Math.random() * 110;
            this.y = GROUND_Y - this.height;
            this.color = '#747d8c';
        } else {
            this.height = 100;
            this.y = GROUND_Y;
            this.color = '#000';
            const holeScale = Math.min(1.6, 1 + (speed - INITIAL_SPEED) * 0.12);
            const rawWidth = 40 + Math.random() * 120 * holeScale;
            this.width = Math.min(rawWidth, 210);
        }
    }

    draw() {
        if (this.type === 'block') {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeStyle = '#2f3542';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x + 5, this.y + 5, this.width - 10, this.height - 10);
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, GROUND_Y, this.width, canvas.height - GROUND_Y);
            // Draw edges of hole
            ctx.strokeStyle = '#2f3542';
            ctx.beginPath();
            ctx.moveTo(this.x, GROUND_Y);
            ctx.lineTo(this.x, canvas.height);
            ctx.moveTo(this.x + this.width, GROUND_Y);
            ctx.lineTo(this.x + this.width, canvas.height);
            ctx.stroke();
        }
    }

    update() {
        this.x -= speed;
    }
}

// UI Elements
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const hud = document.getElementById('hud');
const scoreDisplay = document.getElementById('score-display');
const timeDisplay = document.getElementById('time-display');
const volumeMeter = document.getElementById('volume-meter');
const finalScore = document.getElementById('final-score');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
const sensitivitySliderHud = document.getElementById('sensitivity-slider-hud');
const sensitivityValueHud = document.getElementById('sensitivity-value-hud');
const micTestBtn = document.getElementById('mic-test-btn');
const micTestMeter = document.getElementById('mic-test-meter');
const jumpPreviewText = document.getElementById('jump-preview-text');
const jumpPreviewChicken = document.getElementById('jump-preview-chicken');

async function initAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    } catch (err) {
        console.error("Audio init failed", err);
    }
}

function updateVolume() {
    if (!analyser) return 0;
    analyser.getByteFrequencyData(dataArray);
    let values = 0;
    for (let i = 0; i < dataArray.length; i++) {
        values += dataArray[i];
    }
    const average = values / dataArray.length;
    return Math.min(average / 60, 1.5);
}

function handleJump() {
    currentVolume = updateVolume();
    const meterWidth = Math.min(currentVolume * 100, 100);
    volumeMeter.style.width = `${meterWidth}%`;

    if (currentVolume > sensitivityThreshold) {
        chicken.jump(currentVolume);
    } else {
        chicken.jumpReady = true; // Reset ready when volume drops
    }
}

function createJumpParticles() {
    for (let i = 0; i < 8; i++) {
        particles.push(new Particle(chicken.x + chicken.width / 2, GROUND_Y, '#ffffff'));
    }
}

function spawnCloud() {
    if (Math.random() < 0.01) {
        clouds.push({
            x: canvas.width,
            y: 50 + Math.random() * 100,
            speed: 0.2 + Math.random() * 0.5,
            size: 20 + Math.random() * 30
        });
    }
}

function drawClouds() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    clouds.forEach((c, i) => {
        c.x -= c.speed;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
        ctx.arc(c.x + c.size * 0.6, c.y - c.size * 0.2, c.size * 0.7, 0, Math.PI * 2);
        ctx.arc(c.x + c.size * 1.2, c.y, c.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        if (c.x + c.size * 2 < 0) clouds.splice(i, 1);
    });
}

function spawnObstacle() {
    if (nextObstacleTimer <= 0) {
        const holeChance = Math.min(0.5, 0.25 + (speed - INITIAL_SPEED) * 0.03);
        const type = Math.random() < holeChance ? 'hole' : 'block';
        obstacles.push(new Obstacle(type));

        if (Math.random() < 0.22) {
            obstacleBurst = 1 + Math.floor(Math.random() * 2);
            nextObstacleTimer = 18 + Math.random() * 24;
        } else {
            obstacleBurst = 0;
            const minGap = Math.max(34, 82 - speed * 4.5);
            const maxGap = Math.max(minGap + 10, 150 - speed * 3.5);
            nextObstacleTimer = minGap + Math.random() * (maxGap - minGap);
        }
    } else if (obstacleBurst > 0 && nextObstacleTimer <= 1) {
        const type = Math.random() < 0.5 ? 'hole' : 'block';
        obstacles.push(new Obstacle(type));
        obstacleBurst--;
        nextObstacleTimer = obstacleBurst > 0 ? 20 + Math.random() * 28 : 48 + Math.random() * 40;
    }
    nextObstacleTimer--;
}

function checkCollision() {
    for (let obs of obstacles) {
        if (obs.type === 'block') {
            if (chicken.x + 5 < obs.x + obs.width &&
                chicken.x + chicken.width - 5 > obs.x &&
                chicken.y + 5 < obs.y + obs.height &&
                chicken.y + chicken.height - 5 > obs.y) {
                endGame();
            }
        } else {
            // Hole collision logic moved to chicken.update for falling effect
        }
    }
}

function drawBackground() {
    const skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    skyGradient.addColorStop(0, '#74b9ff');
    skyGradient.addColorStop(1, '#a29bfe');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, canvas.width, GROUND_Y);

    ctx.fillStyle = '#55efc4';
    ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

    ctx.fillStyle = '#00b894';
    ctx.beginPath();
    ctx.arc(200, GROUND_Y, 150, Math.PI, 0);
    ctx.arc(600, GROUND_Y, 120, Math.PI, 0);
    ctx.fill();
}

function update() {
    if (!gameActive) return;
    elapsedSeconds = (performance.now() - gameStartTime) / 1000;
    score = Math.floor(elapsedSeconds * 14);
    scoreDisplay.textContent = `점수: ${score}`;
    timeDisplay.textContent = `시간: ${elapsedSeconds.toFixed(1)}초`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    spawnCloud();
    drawClouds();

    handleJump();
    chicken.update();
    chicken.draw();

    particles.forEach((p, i) => {
        p.update();
        p.draw();
        if (p.life <= 0) particles.splice(i, 1);
    });

    spawnObstacle();

    obstacles.forEach((obs, index) => {
        obs.update();
        obs.draw();
        if (obs.x + obs.width < 0) {
            obstacles.splice(index, 1);
            speed += 0.05;
        }
    });

    checkCollision();

    animationId = requestAnimationFrame(update);
}

function startGame() {
    if (!audioContext) {
        initAudio();
    }
    score = 0;
    speed = INITIAL_SPEED;
    obstacles = [];
    clouds = [];
    particles = [];
    nextObstacleTimer = 0;
    obstacleBurst = 0;
    gameStartTime = performance.now();
    elapsedSeconds = 0;
    scoreDisplay.textContent = `점수: 0`;
    timeDisplay.textContent = `시간: 0.0초`;
    chicken.y = GROUND_Y - chicken.height;
    chicken.vy = 0;
    chicken.mouthOpen = 0;
    chicken.jumpsRemaining = 2;
    chicken.jumpReady = true;
    chicken.isFallingIntoHole = false;

    gameActive = true;
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');

    update();
}

function endGame() {
    gameActive = false;
    cancelAnimationFrame(animationId);
    gameOverScreen.classList.remove('hidden');
    finalScore.textContent = `최종 점수: ${score} (생존 ${elapsedSeconds.toFixed(1)}초)`;
    hud.classList.add('hidden');
}

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

function updateSensitivity(nextValue) {
    const value = Number(nextValue);
    sensitivityThreshold = value;
    sensitivitySlider.value = value.toFixed(2);
    sensitivitySliderHud.value = value.toFixed(2);
    sensitivityValue.textContent = `민감도: ${value.toFixed(2)}`;
    sensitivityValueHud.textContent = value.toFixed(2);
}

async function startMicTest() {
    if (!audioContext) {
        await initAudio();
    }
    if (!analyser) {
        jumpPreviewText.textContent = '마이크 접근 실패: 권한을 확인하세요.';
        return;
    }

    micTestActive = true;
    micTestBtn.textContent = '테스트 중...';

    if (!previewAnimationId) {
        runMicPreviewLoop();
    }
}

function runMicPreviewLoop() {
    if (!micTestActive || gameActive) {
        previewAnimationId = null;
        return;
    }

    const volume = updateVolume();
    const meterWidth = Math.min(volume * 100, 100);
    micTestMeter.style.width = `${meterWidth}%`;

    const jumpForce = Math.min(volume * JUMP_FORCE_MULTIPLIER, 26);
    const jumpPercent = Math.round((jumpForce / 26) * 100);
    jumpPreviewText.textContent = `예상 점프력: ${jumpPercent}%`;

    const activeJump = volume > sensitivityThreshold ? jumpForce : 0;
    const jumpHeight = Math.min(52, activeJump * 2);
    jumpPreviewChicken.style.transform = `translateX(-50%) translateY(${-jumpHeight}px)`;

    previewAnimationId = requestAnimationFrame(runMicPreviewLoop);
}

sensitivitySlider.addEventListener('input', (event) => updateSensitivity(event.target.value));
sensitivitySliderHud.addEventListener('input', (event) => updateSensitivity(event.target.value));
micTestBtn.addEventListener('click', startMicTest);
updateSensitivity(DEFAULT_SENSITIVITY);

function resize() {
    const container = document.getElementById('game-container');
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }
}

window.addEventListener('resize', resize);
resize();
setTimeout(resize, 100);
