const canvas = document.getElementById('void');
const ctx = canvas.getContext('2d');
const titleContainer = document.getElementById('title-container');
const memoryFragments = document.getElementById('memory-fragments');
const frag1 = document.getElementById('frag-1');
const frag2 = document.getElementById('frag-2');
const frag3 = document.getElementById('frag-3');
const whisper = document.getElementById('whisper');
const residue = document.getElementById('residue');

let width, height;
let particles = [];
let tendrils = [];
let mouseX = 0, mouseY = 0;
let lastMouseX = 0, lastMouseY = 0;
let mouseVelX = 0, mouseVelY = 0;
let time = 0;
let breathPhase = 0;
let isMoving = false;
let movementTimer = null;
let hasInteracted = false;

const memories = [
    "i almost said something",
    "a word lost between heartbeats",
    "the shape of a dream i forget",
    "light through a door that closed",
    "the weight of unsaid things",
    "a song i never learned",
    "someone looking away",
    "the moment before knowing"
];

const whispers = [
    "it remembers you",
    "you've been here before",
    "what are you afraid to recall?",
    "leave a trace",
    "nothing ever truly vanishes",
    "the abyss looks back"
];

class Particle {
    constructor(x, y, isTendril = false) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.life = 1.0;
        this.decay = isTendril ? 0.008 : 0.015;
        this.size = isTendril ? Math.random() * 1.5 + 0.5 : Math.random() * 2 + 1;
        this.hue = Math.random() > 0.7 ? 180 + Math.random() * 60 : Math.random() > 0.5 ? 270 + Math.random() * 40 : 340 + Math.random() * 20;
        this.isTendril = isTendril;
        this.angle = Math.random() * Math.PI * 2;
        this.orbitRadius = Math.random() * 20 + 10;
        this.orbitSpeed = (Math.random() - 0.5) * 0.02;
    }
    
    update(mouseX, mouseY) {
        if (this.isTendril) {
            this.angle += this.orbitSpeed;
            const targetX = mouseX + Math.cos(this.angle) * this.orbitRadius;
            const targetY = mouseY + Math.sin(this.angle) * this.orbitRadius;
            this.vx += (targetX - this.x) * 0.01;
            this.vy += (targetY - this.y) * 0.01;
            this.vx *= 0.92;
            this.vy *= 0.92;
        } else {
            this.vx += (mouseX - this.x) * 0.00005;
            this.vy += (mouseY - this.y) * 0.00005;
            this.vx *= 0.98;
            this.vy *= 0.98;
        }
        
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }
    
    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = this.life * (this.isTendril ? 0.6 : 0.4);
        ctx.shadowBlur = this.isTendril ? 15 : 10;
        ctx.shadowColor = `hsla(${this.hue}, 70%, 60%, ${this.life})`;
        ctx.fillStyle = `hsla(${this.hue}, 80%, 70%, ${this.life})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Tendril {
    constructor(x, y) {
        this.points = [];
        this.x = x;
        this.y = y;
        this.life = 1.0;
        this.decay = 0.002;
        for (let i = 0; i < 8; i++) {
            this.points.push({
                x: x + (Math.random() - 0.5) * 10,
                y: y + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5
            });
        }
    }
    
    update(mouseX, mouseY) {
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const force = i === 0 ? 0.02 : 0.01;
            p.vx += (mouseX - p.x) * force * 0.001;
            p.vy += (mouseY - p.y) * force * 0.001;
            p.vx *= 0.95;
            p.vy *= 0.95;
            p.x += p.vx;
            p.y += p.vy;
        }
        this.life -= this.decay;
    }
    
    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = this.life * 0.3;
        ctx.strokeStyle = `rgba(139, 92, 246, ${this.life * 0.4})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(139, 92, 246, 0.5)';
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++) {
            ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }
}

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

function createResidue(x, y) {
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'residue-particle';
        const angle = (Math.PI * 2 * i) / 8;
        const dist = Math.random() * 30 + 20;
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
        particle.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
        residue.appendChild(particle);
        setTimeout(() => particle.remove(), 3000);
    }
}

function showMemory() {
    if (Math.random() > 0.7 && !hasInteracted) {
        const idx = Math.floor(Math.random() * memories.length);
        frag1.textContent = memories[idx];
        frag1.style.left = Math.random() * 60 + 10 + '%';
        frag1.style.top = Math.random() * 40 + 10 + '%';
        
        const idx2 = (idx + 3) % memories.length;
        frag2.textContent = memories[idx2];
        frag2.style.right = Math.random() * 60 + 10 + '%';
        frag2.style.top = Math.random() * 40 + 30 + '%';
        
        const idx3 = (idx + 6) % memories.length;
        frag3.textContent = memories[idx3];
        frag3.style.left = Math.random() * 60 + 10 + '%';
        frag3.style.bottom = Math.random() * 30 + 10 + '%';
        
        memoryFragments.classList.remove('hidden');
        setTimeout(() => memoryFragments.classList.add('hidden'), 12000);
    }
}

function showWhisper() {
    if (Math.random() > 0.8) {
        whisper.textContent = whispers[Math.floor(Math.random() * whispers.length)];
        whisper.classList.remove('hidden');
        setTimeout(() => whisper.classList.add('hidden'), 8000);
    }
}

function animate() {
    time++;
    breathPhase += 0.01;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, width, height);
    
    mouseVelX = mouseX - lastMouseX;
    mouseVelY = mouseY - lastMouseY;
    lastMouseX = mouseX;
    lastMouseY = mouseY;
    
    const speed = Math.sqrt(mouseVelX * mouseVelX + mouseVelY * mouseVelY);
    
    if (speed > 2 && isMoving) {
        for (let i = 0; i < 3; i++) {
            particles.push(new Particle(mouseX, mouseY, true));
        }
        if (speed > 5 && Math.random() > 0.7) {
            tendrils.push(new Tendril(mouseX, mouseY));
        }
    }
    
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(mouseX, mouseY);
        particles[i].draw(ctx);
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        }
    }
    
    for (let i = tendrils.length - 1; i >= 0; i--) {
        tendrils[i].update(mouseX, mouseY);
        tendrils[i].draw(ctx);
        if (tendrils[i].life <= 0) {
            tendrils.splice(i, 1);
        }
    }
    
    if (time % 200 === 0) showMemory();
    if (time % 400 === 0) showWhisper();
    
    const breathe = Math.sin(breathPhase) * 0.02 + 0.98;
    titleContainer.style.transform = `scale(${breathe})`;
    
    requestAnimationFrame(animate);
}

window.addEventListener('resize', resize);

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    
    if (!hasInteracted) {
        hasInteracted = true;
        titleContainer.style.opacity = '0.3';
        titleContainer.style.transform = 'scale(0.7)';
        setTimeout(() => {
            titleContainer.style.opacity = '0.1';
        }, 2000);
    }
    
    isMoving = true;
    clearTimeout(movementTimer);
    movementTimer = setTimeout(() => {
        isMoving = false;
    }, 150);
    
    if (Math.random() > 0.95) {
        createResidue(mouseX, mouseY);
    }
});

window.addEventListener('mousedown', () => {
    for (let i = 0; i < 15; i++) {
        particles.push(new Particle(mouseX, mouseY, Math.random() > 0.5));
    }
    createResidue(mouseX, mouseY);
});

window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    mouseX = e.touches[0].clientX;
    mouseY = e.touches[0].clientY;
    if (!hasInteracted) {
        hasInteracted = true;
        titleContainer.style.opacity = '0.3';
    }
    isMoving = true;
    clearTimeout(movementTimer);
    movementTimer = setTimeout(() => { isMoving = false; }, 150);
}, { passive: false });

resize();
animate();
