import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

// Change this if your backend runs elsewhere
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function App() {
  const [nick, setNick] = useState('');
  const [room, setRoom] = useState('main');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const socketRef = useRef(null);
  const messagesRef = useRef(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    // auto scroll when messages change
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  function join() {
    if (!nick.trim()) {
      alert('Enter a nickname first');
      return;
    }
    const s = io(SERVER_URL);
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      s.emit('join-room', { roomId: room, nick });
    });

    s.on('room-history', (history) => {
      setMessages(history || []);
    });

    s.on('new-message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    s.on('user-joined', (u) => {
      setMessages(prev => [...prev, { id: 'sys-'+Date.now(), nick: 'System', text: `${u.nick} joined the room`, ts: Date.now() }]);
    });

    s.on('user-left', (u) => {
      setMessages(prev => [...prev, { id: 'sys-'+Date.now(), nick: 'System', text: `${u.nick} left the room`, ts: Date.now() }]);
    });

    s.on('typing', ({ id, nick: tn, typing }) => {
      setTypingUsers(prev => {
        const copy = {...prev};
        if (typing) copy[id] = tn;
        else delete copy[id];
        return copy;
      });
    });
  }

  function send() {
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit('send-message', { text });
    setText('');
    socketRef.current.emit('typing', false);
  }

  let typingTimeout = useRef(null);
  function handleTyping(val) {
    setText(val);
    if (!socketRef.current) return;
    socketRef.current.emit('typing', true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socketRef.current.emit('typing', false);
    }, 800);
  }

  return (
    <div className="app">
      <h1>Temporary Chat — No database (messages in RAM)</h1>

      {!connected ? (
        <div style={{display:'grid', gap:8, maxWidth:420}}>
          <input placeholder="Choose a nickname" value={nick} onChange={e=>setNick(e.target.value)} />
          <input placeholder="Room name (default: main)" value={room} onChange={e=>setRoom(e.target.value)} />
          <button onClick={join}>Join Room</button>
          <p style={{opacity:0.8, fontSize:13}}>Messages are stored only while the server runs. Refresh or server restart clears them.</p>
        </div>
      ) : (
        <div>
          <div className="chat">
            <div className="messages" ref={messagesRef} style={{display:'flex',flexDirection:'column'}}>
              {messages.map(m => {
                const isSys = m.nick === 'System';
                const isMe = m.id && socketRef.current && m.id.startsWith(socketRef.current.id);
                return (
                  <div key={m.id} style={{display:'flex', flexDirection:'column', alignItems: isSys ? 'center' : (isMe ? 'flex-end' : 'flex-start')}}>
                    <div className={'message ' + (isSys ? '' : (isMe ? 'me' : 'other'))} style={{maxWidth:'80%'}}>
                      <strong style={{display:'block', marginBottom:6}}>{isSys ? '' : m.nick}</strong>
                      <div>{m.text}</div>
                      <div className="meta">{new Date(m.ts).toLocaleTimeString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{marginTop:8}}>
              {Object.keys(typingUsers).length > 0 && (
                <div style={{fontSize:13, opacity:0.8, marginBottom:6}}>
                  {Object.values(typingUsers).join(', ')} typing...
                </div>
              )}
              <div className="input-row">
                <input type="text" placeholder="Type a message..." value={text} onChange={e=>handleTyping(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter') send(); }} />
                <button onClick={send}>Send</button>
              </div>
              <div style={{marginTop:8}}>
                <button onClick={() => { socketRef.current && socketRef.current.disconnect(); setConnected(false); setMessages([]); }}>Leave Room</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
