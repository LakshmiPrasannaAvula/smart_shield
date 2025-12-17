/**
 * Smart Privacy-Aware AI/ML Patient Monitoring System
 * Frontend JavaScript Application
 * 
 * This module handles:
 * - Webcam access and video streaming
 * - Privacy filter application (pixelation before sending)
 * - Real-time communication with backend API
 * - UI updates for detection indicators
 * - Alerts panel management
 */

class PatientMonitoringApp {
    constructor() {
        this.video = document.getElementById('videoElement');
        this.canvas = document.getElementById('canvasElement');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.overlay = document.getElementById('videoOverlay');
        
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.clearAlertsBtn = document.getElementById('clearAlertsBtn');
        
        this.isMonitoring = false;
        this.stream = null;
        this.analysisInterval = null;
        this.alertsInterval = null;
        
        this.ANALYSIS_INTERVAL = 500;
        this.ALERTS_POLL_INTERVAL = 3000;
        this.PIXELATION_SIZE = 16;
        
        this.init();
    }
    
    init() {
        if (this.startBtn) {
            this.startBtn.addEventListener('click', () => this.startMonitoring());
        }
        if (this.stopBtn) {
            this.stopBtn.addEventListener('click', () => this.stopMonitoring());
        }
        if (this.clearAlertsBtn) {
            this.clearAlertsBtn.addEventListener('click', () => this.clearAlerts());
        }
        
        this.loadAlerts();
        this.updateSystemStatus();
        
        this.alertsInterval = setInterval(() => {
            this.loadAlerts();
            this.updateSystemStatus();
        }, this.ALERTS_POLL_INTERVAL);
    }
    
    async startMonitoring() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                },
                audio: false
            });
            
            this.video.srcObject = this.stream;
            await this.video.play();
            
            this.canvas.width = this.video.videoWidth || 640;
            this.canvas.height = this.video.videoHeight || 480;
            
            this.isMonitoring = true;
            this.overlay.classList.add('hidden');
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            
            this.updateStatusBadge('Monitoring Active', true);
            
            this.renderFrame();
            
            this.analysisInterval = setInterval(() => {
                this.analyzeFrame();
            }, this.ANALYSIS_INTERVAL);
            
            await fetch('/api/status/toggle', { method: 'POST' });
            
        } catch (error) {
            console.error('Error starting monitoring:', error);
            this.showError('Could not access camera. Please allow camera permissions and try again.');
        }
    }
    
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
        
        this.overlay.classList.remove('hidden');
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        
        this.updateStatusBadge('System Ready', false);
        
        this.resetIndicators();
        
        fetch('/api/status/toggle', { method: 'POST' });
    }
    
    renderFrame() {
        if (!this.isMonitoring || !this.ctx) return;
        
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        this.applyPrivacyFilter();
        
        requestAnimationFrame(() => this.renderFrame());
    }
    
    applyPrivacyFilter() {
        const pixelSize = this.PIXELATION_SIZE;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        const faceRegion = {
            x: Math.floor(w * 0.25),
            y: Math.floor(h * 0.05),
            width: Math.floor(w * 0.5),
            height: Math.floor(h * 0.45)
        };
        
        const imageData = this.ctx.getImageData(
            faceRegion.x, 
            faceRegion.y, 
            faceRegion.width, 
            faceRegion.height
        );
        const data = imageData.data;
        
        for (let y = 0; y < faceRegion.height; y += pixelSize) {
            for (let x = 0; x < faceRegion.width; x += pixelSize) {
                let r = 0, g = 0, b = 0, count = 0;
                
                for (let dy = 0; dy < pixelSize && y + dy < faceRegion.height; dy++) {
                    for (let dx = 0; dx < pixelSize && x + dx < faceRegion.width; dx++) {
                        const idx = ((y + dy) * faceRegion.width + (x + dx)) * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                        count++;
                    }
                }
                
                r = Math.floor(r / count);
                g = Math.floor(g / count);
                b = Math.floor(b / count);
                
                for (let dy = 0; dy < pixelSize && y + dy < faceRegion.height; dy++) {
                    for (let dx = 0; dx < pixelSize && x + dx < faceRegion.width; dx++) {
                        const idx = ((y + dy) * faceRegion.width + (x + dx)) * 4;
                        data[idx] = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                    }
                }
            }
        }
        
        this.ctx.putImageData(imageData, faceRegion.x, faceRegion.y);
    }
    
    async analyzeFrame() {
        if (!this.isMonitoring || !this.canvas) return;
        
        try {
            const tempCanvas = document.createElement('canvas');
            const scale = 0.5;
            tempCanvas.width = this.canvas.width * scale;
            tempCanvas.height = this.canvas.height * scale;
            const tempCtx = tempCanvas.getContext('2d');
            
            tempCtx.drawImage(this.video, 0, 0, tempCanvas.width, tempCanvas.height);
            
            const imageData = tempCanvas.toDataURL('image/jpeg', 0.7);
            
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ image: imageData })
            });
            
            if (response.ok) {
                const results = await response.json();
                this.updateIndicators(results);
            }
            
        } catch (error) {
            console.error('Error analyzing frame:', error);
        }
    }
    
    updateIndicators(results) {
        const fallCard = document.getElementById('fallIndicator');
        const fallConfidence = document.getElementById('fallConfidence');
        const fallStatus = fallCard?.querySelector('.indicator-status');
        
        if (fallCard && fallConfidence && fallStatus) {
            if (results.fall_detected) {
                fallCard.classList.add('active-fall');
                fallStatus.textContent = 'FALL DETECTED!';
                fallStatus.style.color = 'var(--danger-color)';
            } else {
                fallCard.classList.remove('active-fall');
                fallStatus.textContent = 'No Fall Detected';
                fallStatus.style.color = '';
            }
            fallConfidence.style.width = `${(results.fall_confidence || 0) * 100}%`;
            fallConfidence.style.background = results.fall_detected ? 'var(--danger-color)' : 'var(--success-color)';
        }
        
        const aggressionCard = document.getElementById('aggressionIndicator');
        const aggressionConfidence = document.getElementById('aggressionConfidence');
        const aggressionStatus = aggressionCard?.querySelector('.indicator-status');
        
        if (aggressionCard && aggressionConfidence && aggressionStatus) {
            if (results.aggression) {
                aggressionCard.classList.add('active-aggression');
                aggressionStatus.textContent = 'AGGRESSION DETECTED!';
                aggressionStatus.style.color = 'var(--warning-color)';
            } else {
                aggressionCard.classList.remove('active-aggression');
                aggressionStatus.textContent = 'Normal Behavior';
                aggressionStatus.style.color = '';
            }
            aggressionConfidence.style.width = `${(results.aggression_confidence || 0) * 100}%`;
            aggressionConfidence.style.background = results.aggression ? 'var(--warning-color)' : 'var(--success-color)';
        }
        
        const riskyCard = document.getElementById('riskyIndicator');
        const riskyConfidence = document.getElementById('riskyConfidence');
        const riskyStatus = riskyCard?.querySelector('.indicator-status');
        
        if (riskyCard && riskyConfidence && riskyStatus) {
            if (results.risky_behavior) {
                riskyCard.classList.add('active-risky');
                riskyStatus.textContent = 'RISKY BEHAVIOR!';
                riskyStatus.style.color = '#eab308';
            } else {
                riskyCard.classList.remove('active-risky');
                riskyStatus.textContent = 'Safe Position';
                riskyStatus.style.color = '';
            }
            riskyConfidence.style.width = `${(results.risky_confidence || 0) * 100}%`;
            riskyConfidence.style.background = results.risky_behavior ? '#eab308' : 'var(--success-color)';
        }
        
        const emotionIcon = document.getElementById('emotionIcon');
        const emotionStatus = document.getElementById('emotionStatus');
        const emotionConfidence = document.getElementById('emotionConfidence');
        
        if (emotionIcon && emotionStatus && emotionConfidence) {
            const emotionIcons = {
                'happy': '&#128522;',
                'sad': '&#128546;',
                'angry': '&#128544;',
                'scared': '&#128552;',
                'neutral': '&#128528;'
            };
            
            const emotionColors = {
                'happy': 'var(--success-color)',
                'sad': 'var(--info-color)',
                'angry': 'var(--danger-color)',
                'scared': 'var(--warning-color)',
                'neutral': 'var(--secondary-color)'
            };
            
            const emotion = results.emotion || 'neutral';
            emotionIcon.innerHTML = emotionIcons[emotion] || emotionIcons['neutral'];
            emotionStatus.textContent = this.capitalizeFirst(emotion);
            emotionStatus.style.color = emotionColors[emotion];
            emotionConfidence.style.width = `${(results.emotion_confidence || 0.5) * 100}%`;
            emotionConfidence.style.background = emotionColors[emotion];
        }
    }
    
    resetIndicators() {
        const cards = document.querySelectorAll('.indicator-card');
        cards.forEach(card => {
            card.classList.remove('active-fall', 'active-aggression', 'active-risky');
            const status = card.querySelector('.indicator-status');
            if (status) {
                status.style.color = '';
            }
        });
        
        const confidenceBars = document.querySelectorAll('.confidence-fill');
        confidenceBars.forEach(bar => {
            bar.style.width = '0%';
        });
    }
    
    async loadAlerts() {
        try {
            const response = await fetch('/api/alerts?limit=20');
            const alerts = await response.json();
            this.renderAlerts(alerts);
        } catch (error) {
            console.error('Error loading alerts:', error);
        }
    }
    
    renderAlerts(alerts) {
        const alertsList = document.getElementById('alertsList');
        if (!alertsList) return;
        
        if (!alerts || alerts.length === 0) {
            alertsList.innerHTML = `
                <div class="no-alerts">
                    <span class="no-alerts-icon">&#10003;</span>
                    <p>No alerts detected</p>
                </div>
            `;
            return;
        }
        
        const alertsHtml = alerts.reverse().map(alert => {
            const alertClass = this.getAlertClass(alert.issue);
            const icon = this.getAlertIcon(alert.issue);
            
            return `
                <div class="alert-item ${alertClass}">
                    <div class="alert-icon">${icon}</div>
                    <div class="alert-content">
                        <div class="alert-title">${alert.issue}</div>
                        <div class="alert-meta">
                            ${this.formatTime(alert.timestamp)} | Confidence: ${(alert.confidence * 100).toFixed(0)}%
                        </div>
                        <div class="alert-action">${alert.action}</div>
                    </div>
                </div>
            `;
        }).join('');
        
        alertsList.innerHTML = alertsHtml;
    }
    
    getAlertClass(issue) {
        if (issue.includes('Fall')) return 'alert-critical';
        if (issue.includes('Aggression')) return 'alert-warning';
        if (issue.includes('Risky')) return 'alert-caution';
        return 'alert-info';
    }
    
    getAlertIcon(issue) {
        if (issue.includes('Fall')) return '&#9888;';
        if (issue.includes('Aggression')) return '&#9889;';
        if (issue.includes('Risky')) return '&#9888;';
        if (issue.includes('Emotion')) return '&#128528;';
        return '&#8505;';
    }
    
    async clearAlerts() {
        try {
            await fetch('/api/alerts/clear', { method: 'POST' });
            this.loadAlerts();
        } catch (error) {
            console.error('Error clearing alerts:', error);
        }
    }
    
    async updateSystemStatus() {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();
            
            const statusBadge = document.getElementById('systemStatus');
            if (statusBadge) {
                const dot = statusBadge.querySelector('.status-dot');
                const text = statusBadge.querySelector('span:last-child');
                
                if (status.monitoring_active) {
                    dot.style.background = 'var(--success-color)';
                    text.textContent = 'Monitoring Active';
                } else {
                    dot.style.background = 'var(--secondary-color)';
                    text.textContent = 'System Ready';
                }
            }
        } catch (error) {
            console.error('Error updating system status:', error);
        }
    }
    
    updateStatusBadge(text, active) {
        const statusBadge = document.getElementById('systemStatus');
        if (statusBadge) {
            const dot = statusBadge.querySelector('.status-dot');
            const label = statusBadge.querySelector('span:last-child');
            
            dot.style.background = active ? 'var(--success-color)' : 'var(--secondary-color)';
            label.textContent = text;
        }
    }
    
    showError(message) {
        alert(message);
    }
    
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    
    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleTimeString();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.monitoringApp = new PatientMonitoringApp();
});
// Handle video upload form submission
const videoForm = document.getElementById("videoUploadForm");
videoForm.addEventListener("submit", async (e) => {
    e.preventDefault();  // prevent page reload
    const formData = new FormData(videoForm);
    
    const response = await fetch("/upload_video", {
        method: "POST",
        body: formData
    });
    
    const data = await response.json();
    console.log("Video Analysis Result:", data);
    alert("Video Analysis Completed:\n" + JSON.stringify(data, null, 2));
});
document.querySelector("#videoUploadForm").addEventListener("submit", async function (event) {
    event.preventDefault();

    let formData = new FormData(this);

    let response = await fetch("/upload_video", {
        method: "POST",
        body: formData
    });

    let result = await response.json();

    document.getElementById("analysisOutput").innerText =
        JSON.stringify(result, null, 2);
});

