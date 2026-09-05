import { useState } from 'react';
import './App.css';

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });

      const data = await response.json();

      const agentMessage = {
        role: 'agent',
        text: data.matched
          ? `${data.reasoning} — ${data.item.name} (₹${data.item.price / 100})`
          : data.reasoning,
        matched: data.matched,
        item: data.matched ? data.item : null,
        status: data.matched ? 'awaiting_confirmation' : null,
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
      const orderResponse = await fetch('http://localhost:5000/api/create-order', {
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
      updateMessageStatus(messageIndex, 'failed');
    }
  };

  const handlePaymentSuccess = async (messageIndex, razorpayResponse) => {
    try {
      const verifyResponse = await fetch('http://localhost:5000/api/verify-payment', {
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

  const updateMessageStatus = (messageIndex, newStatus) => {
    setMessages((prev) =>
      prev.map((msg, i) => (i === messageIndex ? { ...msg, status: newStatus } : msg))
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const renderStatusLabel = (status) => {
    if (status === 'processing') return 'Processing…';
    if (status === 'paid') return '✓ Payment successful';
    if (status === 'failed') return 'Could not create order';
    if (status === 'verification_failed') return 'Payment could not be verified';
    return null;
  };

  return (
    <div className="chat-container">
      <h1>GrowMo</h1>

      <div className="messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            <div>{msg.text}</div>

            {msg.status === 'awaiting_confirmation' && (
              <button
                className="confirm-button"
                onClick={() => handleConfirmAndPay(index, msg.item)}
              >
                Confirm & Pay ₹{msg.item.price / 100}
              </button>
            )}

            {msg.status && msg.status !== 'awaiting_confirmation' && (
              <div className="status-label">{renderStatusLabel(msg.status)}</div>
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
  );
}

export default App;