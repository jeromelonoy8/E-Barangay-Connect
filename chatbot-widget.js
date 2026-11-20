(function () {
    if (!window.Api || !Api.session('resident').token) return;

    const root = document.createElement('div');
    root.id = 'residentChatbot';
    root.className = 'resident-chatbot';
    root.innerHTML = `
        <section class="resident-chat-panel" id="residentChatPanel" aria-label="Barangay help assistant" hidden>
            <header class="resident-chat-header">
                <div>
                    <strong>Barangay Help</strong>
                    <p>AI assistant · General guidance</p>
                </div>
                <button type="button" class="resident-chat-close" id="residentChatClose" aria-label="Close chat">×</button>
            </header>
            <div class="resident-chat-messages" id="residentChatMessages" aria-live="polite"></div>
            <form class="resident-chat-form" id="residentChatForm">
                <label class="sr-only" for="residentChatInput">Ask a question</label>
                <textarea id="residentChatInput" rows="2" maxlength="1500" placeholder="How can I book an appointment?" required></textarea>
                <button type="submit" id="residentChatSend">Send</button>
            </form>
            <p class="resident-chat-note">Don’t share passwords or private account details. Confirm official requirements with barangay staff.</p>
        </section>
        <button type="button" class="resident-chat-launcher" id="residentChatOpen" aria-expanded="false">
            <i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
            <span>Need help?</span>
        </button>
    `;
    document.body.appendChild(root);

    const panel = document.getElementById('residentChatPanel');
    const openButton = document.getElementById('residentChatOpen');
    const closeButton = document.getElementById('residentChatClose');
    const messages = document.getElementById('residentChatMessages');
    const form = document.getElementById('residentChatForm');
    const input = document.getElementById('residentChatInput');
    const sendButton = document.getElementById('residentChatSend');

    function addMessage(text, sender) {
        const bubble = document.createElement('p');
        bubble.className = `resident-chat-message ${sender}`;
        bubble.textContent = text;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
        return bubble;
    }

    function setOpen(open) {
        panel.hidden = !open;
        openButton.setAttribute('aria-expanded', String(open));
        if (open) input.focus();
    }

    addMessage('Hi! I can help explain how to use this site and provide general barangay-service guidance.', 'assistant');
    openButton.addEventListener('click', () => setOpen(panel.hidden));
    closeButton.addEventListener('click', () => setOpen(false));

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;

        addMessage(message, 'resident');
        input.value = '';
        input.disabled = true;
        sendButton.disabled = true;
        const pending = addMessage('Thinking…', 'assistant pending');
        try {
            const data = await Api.request('resident', 'POST', '/api/help/chat', { json: { message } });
            pending.textContent = data.reply;
        } catch (err) {
            pending.textContent = err.message;
        } finally {
            pending.classList.remove('pending');
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    });
})();
