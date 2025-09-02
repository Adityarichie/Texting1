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
  const [room, setRoom] = useState('main');
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
      setMessages(prev => [...prev, { id: 'sys-'+Date.now(), nick: 'System', text: `${u.nick} joined the room` }]);
    });

    s.on('user-left', (u) => {
      setMessages(prev => [...prev, { id: 'sys-'+Date.now(), nick: 'System', text: `${u.nick} left the room` }]);
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
    <div className="h-screen w-screen flex bg-gray-900 text-white overflow-hidden">
      {/* Sidebar for Rooms */}
      {!connected ? (
        <div className="w-64 bg-gray-800 p-4 flex flex-col items-center">
          <h2 className="text-xl font-bold text-pink-300 mb-4">Join a Room</h2>
          <input
            placeholder="Choose a nickname"
            className="w-full p-2 mb-4 rounded-lg bg-gray-700 border border-pink-500 text-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
            value={nick}
            onChange={e => setNick(e.target.value)}
          />
          <input
            placeholder="Room name (default: main)"
            className="w-full p-2 mb-4 rounded-lg bg-gray-700 border border-pink-500 text-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
            value={room}
            onChange={e => setRoom(e.target.value)}
          />
          <button
            onClick={join}
            className="w-full px-4 py-2 rounded-lg bg-pink-500 text-white font-semibold hover:bg-pink-400 transition duration-300"
          >
            Join Room
          </button>
          <p className="text-gray-400 text-sm mt-2">Messages and calls are temporary (RAM only).</p>
        </div>
      ) : (
        <div className="w-64 bg-gray-800 p-4 flex flex-col">
          <h2 className="text-xl font-bold text-pink-300 mb-4">Rooms</h2>
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => { setRoom('main'); socketRef.current.emit('join-room', { roomId: 'main', nick }); }}
              className="w-full text-left p-2 mb-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-pink-300"
            >
              Main
            </button>
            {/* Add more room buttons as needed */}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <header className="bg-gray-800 p-4 text-xl font-bold text-pink-300 border-b border-pink-500">
          Temporary Chat + Video Call - {connected ? room : 'Not Connected'}
        </header>
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 bg-gray-700">
            {messages.map(m => {
              const isSys = m.nick === 'System';
              const isMe = m.id && socketRef.current && m.id.startsWith(socketRef.current.id);
              return (
                <div
                  key={m.id}
                  className={`p-2 rounded-lg max-w-[75%] mb-2 ${
                    isSys
                      ? 'mx-auto text-gray-400 text-sm bg-gray-600'
                      : isMe
                        ? 'ml-auto bg-pink-600 text-white'
                        : 'mr-auto bg-gray-600 text-white'
                  }`}
                >
                  {!isSys && (
                    <strong className={`block mb-1 ${getUserColor(m.nick)} font-medium`}>
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
            <div className="px-4 py-2 text-sm text-pink-300 bg-gray-700 opacity-90">
              {Object.values(typingUsers).join(', ')} typing...
            </div>
          )}

          {/* Input */}
          <div className="p-4 bg-gray-800 border-t border-pink-500 flex items-center gap-4">
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 p-2 rounded-lg bg-gray-900 border border-pink-500 text-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-400"
              value={text}
              onChange={e => handleTyping(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
            />
            <button
              onClick={send}
              className="px-4 py-2 rounded-lg bg-pink-500 text-white font-semibold hover:bg-pink-400 transition duration-300"
            >
              Send
            </button>
            <button
              onClick={() => { socketRef.current.disconnect(); setConnected(false); setMessages([]); }}
              className="px-4 py-2 rounded-lg bg-gray-700 text-pink-300 hover:bg-gray-600 transition duration-300"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Video Call */}
        <div className="p-4 bg-gray-700 border-t border-pink-500">
          <h2 className="text-lg font-bold mb-2 text-pink-300">Video Call</h2>
          <div className="flex gap-4 mb-4">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 bg-black rounded-lg shadow-md" />
            <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 bg-black rounded-lg shadow-md" />
          </div>
          <div className="text-center">
            {!inCall ? (
              <button
                onClick={startCall}
                className="px-4 py-2 rounded-lg bg-pink-500 text-white font-semibold hover:bg-pink-400 transition duration-300"
              >
                Start Call
              </button>
            ) : (
              <button
                onClick={endCall}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500 transition duration-300"
              >
                End Call
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
