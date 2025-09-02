import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

export default function App() {
  const [nick, setNick] = useState("");
  const [room, setRoom] = useState("");
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
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
      alert("Enter a nickname first");
      return;
    }
    const s = io(SERVER_URL);
    socketRef.current = s;

    s.on("connect", () => {
      setConnected(true);
      s.emit("join-room", { roomId: room, nick });
    });

    s.on("room-history", (history) => {
      setMessages(history || []);
    });

    s.on("new-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    s.on("user-joined", (u) => {
      setMessages((prev) => [
        ...prev,
        { id: "sys-" + Date.now(), nick: "System", text: `${u.nick} joined the room` },
      ]);
    });

    s.on("user-left", (u) => {
      setMessages((prev) => [
        ...prev,
        { id: "sys-" + Date.now(), nick: "System", text: `${u.nick} left the room` },
      ]);
    });

    s.on("typing", ({ id, nick: tn, typing }) => {
      setTypingUsers((prev) => {
        const copy = { ...prev };
        if (typing) copy[id] = tn;
        else delete copy[id];
        return copy;
      });
    });

    // video call signaling
    s.on("offer", async (offer) => {
      if (!pcRef.current) createPeerConnection();
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      s.emit("answer", answer);
    });

    s.on("answer", async (answer) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    s.on("ice-candidate", async (candidate) => {
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    });
  }

  function send() {
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit("send-message", { text });
    setText("");
    socketRef.current.emit("typing", false);
  }

  let typingTimeout = useRef(null);
  function handleTyping(val) {
    setText(val);
    if (!socketRef.current) return;
    socketRef.current.emit("typing", true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socketRef.current.emit("typing", false);
    }, 800);
  }

  // ===== VIDEO CALL =====
  function createPeerConnection() {
    pcRef.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", event.candidate);
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

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    stream.getTracks().forEach((track) => pcRef.current.addTrack(track, stream));
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    socketRef.current.emit("offer", offer);
    setInCall(true);
  }

  function endCall() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setInCall(false);
  }

  return (
    <div className="app">
      {!connected ? (
        <div className="join-screen">
          <h1 className="title">💬 Join Chat</h1>
          <input
            placeholder="Choose a nickname"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
          />
          <input
            placeholder="Room name (default: main)"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <button onClick={join}>Join Room</button>
          <p className="note">Messages and calls are temporary (RAM only).</p>
        </div>
      ) : (
        <div className="chat-layout">
          <div className="chat-window">
            <div className="messages" ref={messagesRef}>
              {messages.map((m) => {
                const isSys = m.nick === "System";
                const isMe =
                  m.id && socketRef.current && m.id.startsWith(socketRef.current.id);

                return (
                  <div
                    key={m.id}
                    className={`message ${isSys ? "system" : isMe ? "me" : "other"}`}
                  >
                    {!isSys && <strong>{m.nick}</strong>}
                    <div>{m.text}</div>
                  </div>
                );
              })}
            </div>

            {Object.keys(typingUsers).length > 0 && (
              <div className="typing">
                {Object.values(typingUsers).join(", ")} typing...
              </div>
            )}

            <div className="input-row">
              <input
                type="text"
                placeholder="Type a message..."
                value={text}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />
              <button onClick={send}>Send</button>
              <button
                className="leave"
                onClick={() => {
                  socketRef.current && socketRef.current.disconnect();
                  setConnected(false);
                  setMessages([]);
                }}
              >
                Leave
              </button>
            </div>
          </div>

          <div className="video-call">
            <h2>📹 Video Call</h2>
            <div className="videos-vertical">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <video ref={remoteVideoRef} autoPlay playsInline />
            </div>
            <div className="call-buttons">
              {!inCall ? (
                <button onClick={startCall}>Start Call</button>
              ) : (
                <button className="end" onClick={endCall}>
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
