(function () {
    // 1. Create Styles for the chatbot embed
    const style = document.createElement('style');
    style.innerHTML = `
        #chatbot-embed-container {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 2147483647;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        #chatbot-button {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6495ce 0%, #4a78ad 100%);
            box-shadow: 0 10px 20px -5px rgba(100, 149, 206, 0.5), 0 6px 12px -6px rgba(0, 0, 0, 0.1);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border: none;
            outline: none;
            padding: 0;
            margin: 0;
        }

        #chatbot-button:hover {
            transform: scale(1.1) translateY(-4px);
            box-shadow: 0 15px 25px -5px rgba(100, 149, 206, 0.6), 0 10px 15px -8px rgba(0, 0, 0, 0.15);
        }

        #chatbot-button:active {
            transform: scale(0.95);
        }

        #chatbot-button svg {
            width: 26px;
            height: 26px;
            fill: white;
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        #chatbot-button.active svg {
            transform: rotate(90deg) scale(0.85);
        }

        #chatbot-window {
            position: fixed;
            bottom: 105px;
            right: 30px;
            width: 420px;
            height: 680px;
            max-height: calc(100vh - 140px);
            max-width: calc(100vw - 60px);
            background: #ffffff;
            border-radius: 24px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.12), 0 10px 20px -10px rgba(0, 0, 0, 0.05);
            overflow: hidden;
            display: none;
            flex-direction: column;
            transform: translateY(20px) scale(0.95);
            opacity: 0;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            border: 1px solid rgba(0, 0, 0, 0.08);
            pointer-events: auto;
        }

        #chatbot-window.visible {
            display: flex;
            transform: translateY(0) scale(1);
            opacity: 1;
        }

        #chatbot-window iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: #f8f9fa;
        }

        @media (max-width: 480px) {
            #chatbot-embed-container {
                bottom: 20px;
                right: 20px;
            }
            #chatbot-window {
                bottom: 90px;
                right: 20px;
                width: calc(100vw - 40px);
                height: calc(100vh - 120px);
                border-radius: 20px;
            }
            #chatbot-button {
                width: 56px;
                height: 56px;
            }
        }
    `;
    document.head.appendChild(style);

    // 2. Create Elements
    const container = document.createElement('div');
    container.id = 'chatbot-embed-container';

    const button = document.createElement('button');
    button.id = 'chatbot-button';
    button.setAttribute('aria-label', 'Open Chatbot');
    const chatIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    button.innerHTML = chatIcon;

    const windowDiv = document.createElement('div');
    windowDiv.id = 'chatbot-window';

    const iframe = document.createElement('iframe');
    iframe.src = 'http://localhost:5173';
    iframe.title = 'Rahul';
    iframe.allow = 'clipboard-read; clipboard-write; microphone; camera';

    windowDiv.appendChild(iframe);
    container.appendChild(windowDiv);
    container.appendChild(button);
    document.body.appendChild(container);

    // 3. Toggle Logic
    let isOpen = false;

    button.addEventListener('click', () => {
        isOpen = !isOpen;
        if (isOpen) {
            windowDiv.style.display = 'flex';
            requestAnimationFrame(() => {
                windowDiv.classList.add('visible');
                button.classList.add('active');
                button.innerHTML = closeIcon;
            });
        } else {
            windowDiv.classList.remove('visible');
            button.classList.remove('active');
            button.innerHTML = chatIcon;
            setTimeout(() => {
                if (!isOpen) windowDiv.style.display = 'none';
            }, 500);
        }
    });

    console.log('%c Chatbot Embed Loaded! ', 'background: #6495ce; color: #fff; padding: 5px; border-radius: 4px;');
})();
