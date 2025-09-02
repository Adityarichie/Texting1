import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// simple color palette for usernames
const userColors = [
  'text-pink-400',
  'text-purple-400',
  'text-indigo-400',
  'text-blue-400',
  'text-fuchsia-400',
  'text-rose-400',
];

// hash function to map a username to a color
function getUserColor(nick) {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) {
    hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  }
  return userColors[Math.abs(hash) % userColors.length];
}

export default function App() {
  const [nick, setNick] = useState('');
  const [room, setRoom] = useState('');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const socketRef = useRef(null);
  const messagesRef = useRef(null);

  // video call refs
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [inCall, setInCall] = useState(false);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
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

    // video call signaling
    s.on('offer', async (offer) => {
      if (!pcRef.current) createPeerConnection();
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      s.emit('answer', answer);
    });

    s.on('answer', async (answer) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    s.on('ice-candidate', async (candidate) => {
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
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

  // ===== VIDEO CALL FUNCTIONS =====
  function createPeerConnection() {
    pcRef.current = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', event.candidate);
      }
    };

    pcRef.current.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
  }

  async function startCall() {
    if (!socketRef.current) return;
    createPeerConnection();

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    socketRef.current.emit('offer', offer);
    setInCall(true);
  }

  function endCall() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setInCall(false);
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-black text-pink-400">
      <header className="p-4 bg-pink-600 text-black text-xl font-bold text-center">
        Temporary Chat + Video Call
      </header>

      {!connected ? (
        <div className="flex flex-col gap-4 items-center justify-center flex-1">
          <input
            placeholder="Choose a nickname"
            className="p-2 rounded bg-black border border-pink-500 text-pink-400"
            value={nick}
            onChange={e=>setNick(e.target.value)}
          />
          <input
            placeholder="Room name (default: main)"
            className="p-2 rounded bg-black border border-pink-500 text-pink-400"
            value={room}
            onChange={e=>setRoom(e.target.value)}
          />
          <button
            onClick={join}
            className="px-4 py-2 rounded bg-pink-500 text-black font-bold hover:bg-pink-400"
          >
            Join Room
          </button>
          <p className="opacity-70 text-sm">Messages and calls are temporary (RAM only).</p>
        </div>
      ) : (
        <div className="flex flex-col flex-1">
          {/* Messages */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {messages.map(m => {
              const isSys = m.nick === 'System';
              const isMe = m.id && socketRef.current && m.id.startsWith(socketRef.current.id);
              return (
                <div
                  key={m.id}
                  className={`p-2 rounded max-w-[70%] ${
                    isSys
                      ? 'mx-auto text-gray-400 text-sm'
                      : isMe
                        ? 'ml-auto bg-pink-600 text-black'
                        : 'mr-auto bg-gray-800 text-pink-300'
                  }`}
                >
                  {!isSys && (
                    <strong className={`block mb-1 ${getUserColor(m.nick)}`}>
                      {m.nick}
                    </strong>
                  )}
                  <div>{m.text}</div>
                </div>
              );
            })}
          </div>

          {/* Typing */}
          {Object.keys(typingUsers).length > 0 && (
            <div className="px-4 py-1 text-sm text-pink-400 opacity-70">
              {Object.values(typingUsers).join(', ')} typing...
            </div>
          )}

          {/* Input */}
          <div className="p-4 flex items-center gap-2 border-t border-pink-500 bg-black">
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 p-2 rounded bg-gray-900 border border-pink-500 text-pink-400"
              value={text}
              onChange={e=>handleTyping(e.target.value)}
              onKeyDown={e=>{ if (e.key === 'Enter') send(); }}
            />
            <button
              onClick={send}
              className="px-4 py-2 rounded bg-pink-500 text-black font-bold hover:bg-pink-400"
            >
              Send
            </button>
            <button
              onClick={() => { socketRef.current && socketRef.current.disconnect(); setConnected(false); setMessages([]); }}
              className="px-3 py-2 rounded bg-gray-700 text-pink-400 hover:bg-gray-600"
            >
              Leave
            </button>
          </div>

          {/* Video Call */}
          <div className="p-4 border-t border-pink-500 bg-gray-900">
            <h2 className="text-lg font-bold mb-2">Video Call</h2>
            <div className="flex gap-4">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 bg-black rounded" />
              <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 bg-black rounded" />
            </div>
            <div className="mt-4">
              {!inCall ? (
                <button
                  onClick={startCall}
                  className="px-4 py-2 rounded bg-pink-500 text-black font-bold hover:bg-pink-400"
                >
                  Start Call
                </button>
              ) : (
                <button
                  onClick={endCall}
                  className="px-4 py-2 rounded bg-red-600 text-white font-bold hover:bg-red-500"
                >
                  End Call
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
