const chat = async (messages) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4',
            messages,
            temperature: 1,
            max_tokens: 512,
            top_p: 0.001,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
};

export default {chat};
