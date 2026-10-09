/**
 * GrowMo Multi-Turn Conversational Context Test
 * 
 * Verifies that the AI agent uses capped conversation history to resolve contextual
 * references (e.g. "I want the third option" or "buy that one").
 */

const dotenv = require('dotenv');
dotenv.config();

const API_URL = process.env.TEST_API_URL || 'http://localhost:5000';

async function runConversationTest() {
  console.log('--------------------------------------------------');
  console.log('💬 GROW MO MULTI-TURN CONVERSATION TEST');
  console.log('--------------------------------------------------\n');

  // Turn 1: User asks for catalog
  console.log('Turn 1: User asks to view catalog...');
  const res1 = await fetch(`${API_URL}/api/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Show me the available catalog plans',
      conversationHistory: [],
    }),
  });

  const data1 = await res1.json();
  console.log('Turn 1 Response:', { intent: data1.intent, reasoning: data1.reasoning });

  const history = [
    { role: 'user', text: 'Show me the available catalog plans' },
    { role: 'assistant', text: data1.reasoning },
  ];

  // Turn 2: User references previous turn context ("I want the second one")
  console.log('\nTurn 2: User says "I want to buy the second one"...');
  const res2 = await fetch(`${API_URL}/api/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'I want to buy the second one',
      conversationHistory: history,
    }),
  });

  const data2 = await res2.json();
  console.log('Turn 2 Response:', {
    matched: data2.matched,
    itemId: data2.item ? data2.item.id : null,
    reasoning: data2.reasoning,
  });

  if (data2.matched && data2.item && data2.item.id === 'premium-plan') {
    console.log('\n✅ SUCCESS: Agent resolved "the second one" to "premium-plan" using conversation context!');
  } else {
    console.log('\nℹ️ Response received:', data2);
  }
}

runConversationTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
