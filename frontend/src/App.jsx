import { useState, useEffect } from 'react';
import './App.css';

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.15 }
    );

    const sections = document.querySelectorAll('.fade-in-section');
    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'agent', text: data.error || 'Something went wrong understanding your request.' },
        ]);
        setLoading(false);
        return;
      }

            const agentMessage = {
        role: 'agent',
        text: data.intent === 'list_catalog'
          ? data.reasoning
          : data.matched
            ? `${data.reasoning} — ${data.item.name} (₹${data.item.price / 100})`
            : data.reasoning,
        matched: data.matched,
        item: data.matched ? data.item : null,
        status: data.matched ? 'awaiting_confirmation' : null,
        catalogList: data.intent === 'list_catalog' ? data.catalog : null,
      };

      setMessages((prev) => [...prev, agentMessage]);
    } catch (error) {
      console.error('Error talking to backend:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'agent', text: 'Something went wrong reaching the server.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAndPay = async (messageIndex, item) => {
    // Mark this message as "processing" so the button disables and doesn't get double-clicked
    updateMessageStatus(messageIndex, 'processing');

    try {
      const orderResponse = await fetch(`${API_URL}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        throw new Error(orderData.error || 'Failed to create order');
      }

      const options = {
        key: RAZORPAY_KEY_ID,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'GrowMo',
        description: item.name,
        order_id: orderData.order.id,
        handler: async (response) => {
          await handlePaymentSuccess(messageIndex, response);
        },
        modal: {
          ondismiss: () => {
            updateMessageStatus(messageIndex, 'awaiting_confirmation');
          },
        },
        theme: {
          color: '#14b8a6',
        },
      };

      const razorpayCheckout = new window.Razorpay(options);
      razorpayCheckout.open();
    } catch (error) {
      console.error('Error creating order:', error);
      updateMessageStatus(messageIndex, 'failed', error.message);
    }
  };

  const handlePaymentSuccess = async (messageIndex, razorpayResponse) => {
    try {
      const verifyResponse = await fetch(`${API_URL}/api/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: razorpayResponse.razorpay_order_id,
          razorpay_payment_id: razorpayResponse.razorpay_payment_id,
          razorpay_signature: razorpayResponse.razorpay_signature,
        }),
      });

      const verifyData = await verifyResponse.json();

      updateMessageStatus(messageIndex, verifyData.verified ? 'paid' : 'verification_failed');
    } catch (error) {
      console.error('Error verifying payment:', error);
      updateMessageStatus(messageIndex, 'verification_failed');
    }
  };

  const updateMessageStatus = (messageIndex, newStatus, detail = null) => {
    setMessages((prev) =>
      prev.map((msg, i) => (i === messageIndex ? { ...msg, status: newStatus, statusDetail: detail } : msg))
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const renderStatusLabel = (status, detail) => {
    if (status === 'processing') return 'Processing…';
    if (status === 'paid') return '✓ Payment successful';
    if (status === 'failed') return detail || 'Could not create order';
    if (status === 'verification_failed') return 'Payment could not be verified';
    return null;
  };

  return (
    <div className="landing-layout">
      {/* Section 1 — Hero */}
      <section className="hero-section fade-in-section">
        <div className="hero-content">
          <h1 className="hero-title">GrowMo</h1>
          <p className="hero-subtitle">Tell it what you want. It figures out the rest.</p>
        </div>
        <a href="#what-this-is" className="scroll-indicator" aria-label="Scroll down">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </a>
      </section>

      {/* Section 2 — What this is */}
      <section id="what-this-is" className="info-section fade-in-section">
        <div className="section-container">
          <h2 className="section-title">Checkout, without the checkout</h2>
          <p className="section-body">
            Most online purchases mean browsing, adding to cart, and clicking through forms. GrowMo replaces that with a conversation — say what you want, and an AI agent handles the rest.
          </p>
        </div>
      </section>

      {/* Section 3 — How it works */}
      <section className="features-section fade-in-section">
        <div className="section-container">
          <div className="features-grid">
            <div className="feature-card">
              <span className="feature-number">01</span>
              <h3 className="feature-title">Explainable</h3>
              <p className="feature-desc">Every decision comes with plain-language reasoning, not a black box.</p>
            </div>
            <div className="feature-card">
              <span className="feature-number">02</span>
              <h3 className="feature-title">Bounded</h3>
              <p className="feature-desc">Hard spending limits the agent can never exceed.</p>
            </div>
            <div className="feature-card">
              <span className="feature-number">03</span>
              <h3 className="feature-title">Gated</h3>
              <p className="feature-desc">Nothing is charged without your explicit confirmation.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4 — The application itself */}
      <section id="app-section" className="app-section fade-in-section">
        <div className="chat-container">
          <h1>GrowMo</h1>

          <div className="messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div>{msg.text}</div>

                {msg.catalogList && (
                  <ul className="catalog-list">
                    {msg.catalogList.map((product) => (
                      <li key={product.id}>
                        {product.name} — ₹{product.price / 100}
                      </li>
                    ))}
                  </ul>
                )}

                {msg.status === 'awaiting_confirmation' && (
                  <button
                    className="confirm-button"
                    onClick={() => handleConfirmAndPay(index, msg.item)}
                  >
                    Confirm & Pay ₹{msg.item.price / 100}
                  </button>
                )}

                {msg.status && msg.status !== 'awaiting_confirmation' && (
                  <div className="status-label">{renderStatusLabel(msg.status, msg.statusDetail)}</div>
                )}
              </div>
            ))}
            {loading && <div className="message agent">Thinking...</div>}
          </div>

          <div className="input-row">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What would you like to buy?"
            />
            <button onClick={sendMessage} disabled={loading}>
              Send
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;