import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { MATouchPlatform } from './platform';
import type { Peripheral } from '@abandonware/noble';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class MATouchPlatformAccessory {
  private service: Service;
  private pin: Buffer;
  private updateTimeout: ReturnType<typeof setTimeout>;
  private msgid: number = 0;
  private receiveLength = 0;
  private receiveBuffer;
  private receiveResolve;

  private currentState = {
    Active: 0,
    CurrentHeaterCoolerState: 0,
    TargetHeaterCoolerState: 0,
    CurrentTemperature: 10,
    CoolingThresholdTemperature: 10,
    HeatingThresholdTemperature: 10,
  };

  private changedState = {
    Active: false,
    TargetHeaterCoolerState: false,
    CoolingThresholdTemperature: false,
    HeatingThresholdTemperature: false,
  };

  constructor(
    private readonly platform: MATouchPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly peripheral: Peripheral,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi Electric')
      .setCharacteristic(this.platform.Characteristic.Model, 'PAR-CT01MAU')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, peripheral.advertisement.localName.substring(12));

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, peripheral.advertisement.localName);

    // register handlers for the Heater Cooler Characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.handleTargetHeaterCoolerStateGet.bind(this))
      .onSet(this.handleTargetHeaterCoolerStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));
  
    this.pin = this.pinToHex(this.platform.config.pin || 0);

    // Update characteristics values asynchronously
    this.updateTimeout = setTimeout(async () => await this.update(), 250);
  }

  // MARK: - Updates

  async update() {
    this.platform.log.debug('update()');

    clearTimeout(this.updateTimeout);

    if (this.peripheral.state == 'connected') {
      this.updateTimeout = setTimeout(async () => await this.update(), 3000);
      return;
    } else {
      this.updateTimeout = setTimeout(async () => await this.update(), 10000);
    }
    
    this.platform.log.info('Connecting...');
    await this.peripheral.connectAsync();

    const {characteristics} = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(['0277df18-e796-11e6-bf01-fe55135034f3'], 
      [
        '799e3b22-e797-11e6-bf01-fe55135034f3', // handle = 0x0012, char properties = 0x02, char value handle = 0x0013, uuid = 799e3b22-e797-11e6-bf01-fe55135034f3
        'def9382a-e795-11e6-bf01-fe55135034f3', // handle = 0x0014, char properties = 0x02, char value handle = 0x0015, uuid = def9382a-e795-11e6-bf01-fe55135034f3
        'e48c1528-e795-11e6-bf01-fe55135034f3', // handle = 0x0016, char properties = 0x0c, char value handle = 0x0017, uuid = e48c1528-e795-11e6-bf01-fe55135034f3
        'ea1ea690-e795-11e6-bf01-fe55135034f3', // handle = 0x0018, char properties = 0x10, char value handle = 0x0019, uuid = ea1ea690-e795-11e6-bf01-fe55135034f3
      ]);
    
    const c0 = characteristics[0];
    const v0 = await c0.readAsync();
    this.platform.log.debug("Read c0:", v0);
    if (Buffer.compare(v0, Buffer.from([0x30, 0x31, 0x2e, 0x30, 0x30, 0x2e, 0x30, 0x30])) != 0)
      this.platform.log.error('Unexpected c0 value:', v0);

    const c1 = characteristics[1];
    const v1 = await c1.readAsync();
    this.platform.log.debug("Read c1:", v1);
    if (Buffer.compare(v1, Buffer.from([0x43, 0x54, 0x30, 0x31, 0x4d, 0x41, 0x55, 0x5f, 0x30, 0x31, 0x2e, 0x36, 0x31, 0x00, 0x00, 0x00, 0x00, 0x41])) != 0)
      this.platform.log.error('Unexpected c1 value:', v1);

    const c3 = characteristics[3];
    c3.notify(true);

    c3.on('data', async (data, notify) => {
      this.platform.log.info('Received:', this.receiveLength, data);

      if (this.receiveLength == 0) {
        const len = data.readUInt8();
        // TODO: check checksum, maybe trim it off the message
        this.receiveBuffer = Buffer.alloc(len);
        data.copy(this.receiveBuffer, 0, 2);
        this.receiveLength += data.length - 2;
      } else {
        data.copy(this.receiveBuffer, this.receiveLength);
        this.receiveLength += data.length;
      }

      if (this.receiveBuffer.length == this.receiveLength) {
        await this.receivedMessage(this.receiveBuffer);
        this.receiveLength = 0;
      }
    });

    // let's talk...
    const c2 = characteristics[2];
    await this.sendCommand(c2, Buffer.from([0x01, 0x00, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x03, 0x00, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x01, 0x03, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x05, 0x00, 0x00])); // not sure?
    await this.sendCommand(c2, Buffer.from([0x03, 0x03, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x01, 0x04, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    
    if (this.changedState.Active) {
      await this.maSetOnOff(c2, this.currentState.Active)
      this.changedState.Active = false;
    } 

    if (this.changedState.TargetHeaterCoolerState) {
      const mode = this.targetHeaterCoolerStateToMAMode(this.currentState.TargetHeaterCoolerState);
      await this.maSetMode(c2, mode)
      this.changedState.TargetHeaterCoolerState = false;
    }

    if (this.changedState.CoolingThresholdTemperature) {
      await this.maSetCoolingSetpoint(c2, this.currentState.CoolingThresholdTemperature)
      this.changedState.CoolingThresholdTemperature = false;
    }

    if (this.changedState.HeatingThresholdTemperature) {
      await this.maSetHeatingSetpoint(c2, this.currentState.HeatingThresholdTemperature)
      this.changedState.HeatingThresholdTemperature = false;
    }

    const status = await this.sendCommand(c2, Buffer.from([0x05, 0x02, 0x00]));
    await this.processStatus(status);

    await this.sendCommand(c2, Buffer.from([0x03, 0x04, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x01, 0x01, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    await this.sendCommand(c2, Buffer.from([0x03, 0x01, 0x01, this.pin[0], this.pin[1], 0x00, 0x00, 0x00]));
    this.platform.log.info('Disconnecting!');
    await this.peripheral.disconnectAsync(); 
  }

  // MARK: - Comm

  // [2: length] [1: msgid] [l: body] [2: cksum]
  async sendCommand(characteristic, body) : Promise<Buffer> {
    // await this.delay(500);
    return new Promise<Buffer>((resolve, reject) => { 
      var buffer = Buffer.alloc(2 + 1 + body.length + 2);
      buffer.writeUInt16LE(1 + body.length + 2, 0);
      buffer.writeUInt8(this.msgid, 2);
      body.copy(buffer, 3);
      buffer.writeUInt16LE(this.checksum(buffer), buffer.length - 2);
      //this.platform.log.info('Full packet:', buffer, buffer.length);
      for (let i = 0; i < buffer.length; i += 20) {
        const part = buffer.slice(i, Math.min(buffer.length, i + 20));
        this.platform.log.info('Sent:', part, i, buffer.length - i)
        characteristic.write(part, true); // TODO: handle thrown errors here and other places
      }
      this.msgid += 1; 
      if (this.msgid > 7) this.msgid = 0;
      this.receiveResolve = resolve;
    });
  }

  async receivedMessage(data) {
    this.platform.log.debug("Message:", data)
    this.receiveResolve(data);
    this.receiveResolve = undefined;
  }

  // MARK: - Control

  async maControlCommand(c, flagsA, flagsB, mode, coolSetpoint, heatSetpoint) {
    // off:       05 0101 0100 0010 4502 1002 9001 4002 9001 6400 00
    // on:        05 0101 0100 0011 4502 1002 9001 4002 9001 6400 00
    // mode auto: 05 0101 0200 0079 4502 1002 9001 4002 9001 6400 00
    // mode cool: 05 0101 0200 0009 4502 1002 9001 4002 9001 6400 00
    // mode heat: 05 0101 0200 0011 4502 1002 9001 4002 9001 6400 00
    // mode dry:  05 0101 0200 0031 4502 1002 9001 4002 9001 6400 00
    // mode fan:  05 0101 0200 0001 4502 1002 9001 4002 9001 6400 00
    // heat setp: 05 0101 0002 0011 4502 2002 9001 4002 9001 6400 00
    // cool setp: 05 0101 0001 0009 4002 1002 9001 4002 9001 6400 00
    const cool = this.rawDecToHex(coolSetpoint);
    const heat = this.rawDecToHex(heatSetpoint);
    await this.sendCommand(c, Buffer.from([0x05, 0x01, 0x01, flagsA, flagsB, 0x00, mode, cool[0], cool[1],  heat[0], heat[1], 0x90, 0x01, 0x40, 0x02, 0x90, 0x01, 0x64, 0x00, 0x00]));
  }

  async maSetOnOff(c, yorn) {
    await this.maControlCommand(c, 0x01, 0x00, yorn ? 0x11 : 0x10, this.currentState.CoolingThresholdTemperature, this.currentState.HeatingThresholdTemperature)
  }

  async maSetMode(c, mode) {
    await this.maControlCommand(c, 0x02, 0x00, this.targetHeaterCoolerStateToMAMode(this.currentState.TargetHeaterCoolerState), this.currentState.CoolingThresholdTemperature, this.currentState.HeatingThresholdTemperature)
  }

  async maSetCoolingSetpoint(c, coolingSetpoint) {
    await this.maControlCommand(c, 0x00, 0x01, this.targetHeaterCoolerStateToMAMode(this.currentState.TargetHeaterCoolerState), coolingSetpoint, this.currentState.HeatingThresholdTemperature)
  }

  async maSetHeatingSetpoint(c, heatingSetpoint) {
    await this.maControlCommand(c, 0x00, 0x02, this.targetHeaterCoolerStateToMAMode(this.currentState.TargetHeaterCoolerState), this.currentState.CoolingThresholdTemperature, heatingSetpoint)
  }

  // MARK: - Status

  async processStatus(data) {
    if (data.readUInt8(1) != 0x05 || data.length != 0x35) {
      this.platform.log.error('Invalid status reply:', data)
      return;
    }

    const mode = data.readUInt8(7);
    switch (mode) {
    case 0x78: // off (x78: auto, x10:heat, x08:cool)
    case 0x10: 
    case 0x08: 
      this.currentState.Active = this.platform.Characteristic.Active.INACTIVE
      break;
    case 0x02: // fan
      break;
    case 0x32: // dry
      break;
    case 0x12: // heat
      this.currentState.Active = this.platform.Characteristic.Active.ACTIVE
      this.currentState.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      break;
    case 0x0a: // cool
      this.currentState.Active = this.platform.Characteristic.Active.ACTIVE
      this.currentState.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      break;
    case 0x7a: // auto
      this.currentState.Active = this.platform.Characteristic.Active.ACTIVE
      this.currentState.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      break;
    default:
      this.platform.log.error('Unexpected mode:', mode)
      break;
    }
    this.platform.log.info('Active:', this.currentState.Active);
    this.service.updateCharacteristic(this.platform.Characteristic.Active, this.currentState.Active);
    this.platform.log.info('TargetHeaterCoolerState:', this.currentState.TargetHeaterCoolerState);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, this.currentState.TargetHeaterCoolerState);

    const targetCoolTemp = this.rawHexToDec(data, 28);
    this.platform.log.info('CoolingThresholdTemperature:', targetCoolTemp);
    this.currentState.CoolingThresholdTemperature = targetCoolTemp;
    this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.currentState.CoolingThresholdTemperature);

    const targetHeatTemp = this.rawHexToDec(data, 30);
    this.platform.log.info('HeatingThresholdTemperature:', targetHeatTemp);
    this.currentState.HeatingThresholdTemperature = targetHeatTemp;
    this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.currentState.HeatingThresholdTemperature);

    const currentTemp = this.rawHexToDec(data, 45);
    this.platform.log.info('CurrentTemperature:', currentTemp);
    this.currentState.CurrentTemperature = currentTemp;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.currentState.CurrentTemperature);

    if (this.currentState.Active == this.platform.Characteristic.Active.ACTIVE) {
      switch (this.currentState.TargetHeaterCoolerState) {
      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        if (this.currentState.CurrentTemperature <= this.currentState.HeatingThresholdTemperature) {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        } else {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        }
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        if (this.currentState.CurrentTemperature >= this.currentState.CoolingThresholdTemperature) {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        } else {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        }
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        if (this.currentState.CurrentTemperature < this.currentState.HeatingThresholdTemperature) {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        } else if (this.currentState.CurrentTemperature > this.currentState.CoolingThresholdTemperature) {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        } else {
          this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        }
        break;
      }
      // const state = data.readUInt8(45);
      // switch (state) {
      // case 0x15: // heat
      //   this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      //   break;
      // case 0x06: // cool
      //   this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      //   break;
      // default:
      //   this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      //   break;
      // }
    } else {
      this.currentState.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    this.platform.log.info('CurrentHeaterCoolerState:', this.currentState.CurrentHeaterCoolerState);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.currentState.CurrentHeaterCoolerState);
  }

  // MARK: - Utility

  checksum(buffer: Buffer): number {
    return buffer.reduce((a, b) => (a + b) & 0xffff, 0);
  }

  rawHexToDec(buffer: Buffer, offset: number) : number {
    const a = buffer.readUInt8(offset + 1); // 01
    const b = buffer.readUInt8(offset); // 95
    return (((a & 0xf)*100)+((b >> 4)*10)+(b & 0xf))/10.0;
  }

  rawDecToHex(n: number) : Buffer {
    const a = Math.trunc(n / 10); // 1
    const b = Math.trunc(n % 10); // 9
    const c = n * 10 % 10; // 5
    var buffer = Buffer.alloc(2);
    buffer.writeUInt8(a, 1);
    buffer.writeUInt8((b << 4) + c, 0);
    return buffer;
  }

  pinToHex(n: number) : Buffer {
    const a = Math.trunc(n / 1000); // 1
    const b = Math.trunc(n / 100 % 10); // 2
    const c = Math.trunc(n / 10 % 10); // 3
    const d = n % 10; // 4
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8((a << 4) + b, 1);
    buffer.writeUInt8((c << 4) + d, 0);
    return buffer;
  }

  targetHeaterCoolerStateToMAMode(targetHeaterCoolerState) : number {
    switch (targetHeaterCoolerState) {
    case this.platform.Characteristic.TargetHeaterCoolerState.AUTO: return 0x79;
    case this.platform.Characteristic.TargetHeaterCoolerState.HEAT: return 0x11;
    case this.platform.Characteristic.TargetHeaterCoolerState.COOL: return 0x09;
    default: return 0x79;
    }
  }

  delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  // MARK: - HomeKit API

 /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  handleActiveGet() {
    this.platform.log.debug('Triggered GET Active');

    return this.currentState.Active;
  }

   /**
   * Handle requests to set the current value of the "Active" characteristic
   */
  handleActiveSet(value) {
    this.platform.log.debug('Triggered SET Active');

    if (this.currentState.Active != value) {
      this.currentState.Active = value;
      this.changedState.Active = true;
      this.update();
    }
  }

 /**
  * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
  */
  handleCurrentHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');

    return this.currentState.CurrentHeaterCoolerState;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');

    return this.currentState.TargetHeaterCoolerState;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeaterCoolerStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);

    if (this.currentState.TargetHeaterCoolerState != value) {
      this.currentState.TargetHeaterCoolerState = value;
      this.changedState.TargetHeaterCoolerState = true;
      this.update();
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    return this.currentState.CurrentTemperature;
  }


  /**
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  handleCoolingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    return this.currentState.CoolingThresholdTemperature;
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  handleCoolingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET CoolingThresholdTemperature:', value);

    if (this.currentState.CoolingThresholdTemperature != value) {
      this.currentState.CoolingThresholdTemperature = value;
      this.changedState.CoolingThresholdTemperature = true;
      this.update();
    }
  }

  /**
   * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
   */
  handleHeatingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET HeatingThresholdTemperature');

    return this.currentState.HeatingThresholdTemperature;
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  handleHeatingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET HeatingThresholdTemperature:', value);

    if (this.currentState.HeatingThresholdTemperature != value) {
      this.currentState.HeatingThresholdTemperature = value;
      this.changedState.HeatingThresholdTemperature = true;
      this.update();
    }
  }

}
