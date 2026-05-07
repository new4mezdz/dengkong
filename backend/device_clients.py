from backend.modbus import ModbusTCP


class BaseRelayClient:
    protocol = ""

    def connect(self, device):
        raise NotImplementedError

    def close(self):
        raise NotImplementedError

    def read_relays(self, device):
        raise NotImplementedError

    def write_relay(self, device, channel, value):
        raise NotImplementedError

    def write_relays(self, device, start, values):
        raise NotImplementedError


class ModbusRelayClient(BaseRelayClient):
    protocol = "modbus_tcp"

    def __init__(self):
        self.transport = ModbusTCP()

    def connect(self, device):
        return self.transport.connect(device["ip"], device["port"])

    def close(self):
        self.transport.close()

    def read_relays(self, device):
        return self.transport.read_coils(device["unit_id"], 0, device["channel_count"])

    def write_relay(self, device, channel, value):
        self.transport.write_single_coil(device["unit_id"], channel, value)

    def write_relays(self, device, start, values):
        self.transport.write_multiple_coils(device["unit_id"], start, values)


class SiemensS7RelayClient(BaseRelayClient):
    protocol = "siemens_s7"
    NOT_READY_MESSAGE = "Siemens S7-1200 settings are ready, but the S7 driver is not wired in yet."

    def connect(self, device):
        raise NotImplementedError(self.NOT_READY_MESSAGE)

    def close(self):
        return None

    def read_relays(self, device):
        raise NotImplementedError(self.NOT_READY_MESSAGE)

    def write_relay(self, device, channel, value):
        raise NotImplementedError(self.NOT_READY_MESSAGE)

    def write_relays(self, device, start, values):
        raise NotImplementedError(self.NOT_READY_MESSAGE)


CLIENTS_BY_PROTOCOL = {
    ModbusRelayClient.protocol: ModbusRelayClient,
    SiemensS7RelayClient.protocol: SiemensS7RelayClient,
}


def create_device_client(protocol):
    client_cls = CLIENTS_BY_PROTOCOL.get(protocol)
    if client_cls is None:
        raise ValueError(f"Unsupported device protocol: {protocol}")
    return client_cls()
