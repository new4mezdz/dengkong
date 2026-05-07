import socket
import struct
import threading


class ModbusTCP:
    def __init__(self):
        self.sock = None
        self.transaction_id = 0
        self.lock = threading.Lock()

    def connect(self, ip, port, timeout=3):
        try:
            if self.sock:
                self.close()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect((ip, port))
            return True
        except Exception:
            self.sock = None
            return False

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def _send_receive(self, unit_id, pdu):
        with self.lock:
            if not self.sock:
                raise ConnectionError("未连接")
            self.transaction_id = (self.transaction_id + 1) % 65536
            mbap = struct.pack(">HHHB", self.transaction_id, 0, len(pdu) + 1, unit_id)
            self.sock.sendall(mbap + pdu)
            header = self._recv_exact(7)
            response_length = struct.unpack(">H", header[4:6])[0]
            return self._recv_exact(response_length - 1)

    def _recv_exact(self, size):
        buffer = b""
        while len(buffer) < size:
            chunk = self.sock.recv(size - len(buffer))
            if not chunk:
                raise ConnectionError("连接断开")
            buffer += chunk
        return buffer

    def read_coils(self, unit_id, address, count):
        pdu = struct.pack(">BHH", 0x01, address, count)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x81:
            raise Exception(f"错误码 {data[1]}")

        bits = []
        for byte_value in data[2 : 2 + data[1]]:
            for bit in range(8):
                bits.append(bool(byte_value & (1 << bit)))
        return bits[:count]

    def write_single_coil(self, unit_id, address, value):
        pdu = struct.pack(">BHH", 0x05, address, 0xFF00 if value else 0x0000)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x85:
            raise Exception(f"错误码 {data[1]}")

    def write_multiple_coils(self, unit_id, address, values):
        count = len(values)
        byte_count = (count + 7) // 8
        coil_bytes = [0] * byte_count
        for index, enabled in enumerate(values):
            if enabled:
                coil_bytes[index // 8] |= 1 << (index % 8)
        pdu = struct.pack(">BHHB", 0x0F, address, count, byte_count) + bytes(coil_bytes)
        data = self._send_receive(unit_id, pdu)
        if data[0] == 0x8F:
            raise Exception(f"错误码 {data[1]}")

