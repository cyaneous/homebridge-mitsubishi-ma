import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { ExampleHomebridgePlatform } from './platform';

import type { Peripheral } from '@abandonware/noble';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ExamplePlatformAccessory {
  private service: Service;
  private updateTimeout: ReturnType<typeof setTimeout>;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private thermostatStates = {
    Active: 0,
    CurrentHeaterCoolerState: 0, // this.platform.Characteristic.CurrentHeaterCoolerState.OFF
    TargetHeaterCoolerState: 0, // this.platform.Characteristic.TargetHeaterCoolerState.OFF
    CurrentTemperature: 10,
    CoolingThresholdTemperature: 10,
    HeatingThresholdTemperature: 10,
  };

  constructor(
    private readonly platform: ExampleHomebridgePlatform,
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
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, peripheral.advertisement.localName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // register handlers for the Thermostat Characteristics
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

  
   /**
    * Update characteristics values asynchronously.
    */

    this.updateTimeout = setTimeout(async () => {
      await this.update();
    }, 500);
  }

  async forceUpdate() {
    clearTimeout(this.updateTimeout);

    this.updateTimeout = setTimeout(this.update, 1000);
  }

  async update() {
    this.platform.log.debug('update()');

    clearTimeout(this.updateTimeout);

    this.updateTimeout = setTimeout(async () => {
      await this.update();
    }, 10000);

    if (this.peripheral.state == 'connected') return;
    
    this.platform.log.info('connecting');
    await this.peripheral.connectAsync();

    const {characteristics} = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(['0277df18-e796-11e6-bf01-fe55135034f3'], 
      [
        '799e3b22-e797-11e6-bf01-fe55135034f3', // handle = 0x0012, char properties = 0x02, char value handle = 0x0013, uuid = 799e3b22-e797-11e6-bf01-fe55135034f3
        'def9382a-e795-11e6-bf01-fe55135034f3', // handle = 0x0014, char properties = 0x02, char value handle = 0x0015, uuid = def9382a-e795-11e6-bf01-fe55135034f3
        'e48c1528-e795-11e6-bf01-fe55135034f3', // handle = 0x0016, char properties = 0x0c, char value handle = 0x0017, uuid = e48c1528-e795-11e6-bf01-fe55135034f3
        'ea1ea690-e795-11e6-bf01-fe55135034f3' // handle = 0x0018, char properties = 0x10, char value handle = 0x0019, uuid = ea1ea690-e795-11e6-bf01-fe55135034f3
      ]);
    
    const c0 = characteristics[0];
    const v0 = await c0.readAsync();
    this.platform.log.info("read c0", v0);

    const c1 = characteristics[1];
    const v1 = await c1.readAsync();
    this.platform.log.info("read c1", v1);

    // const responseMaybeNotSure = await this.peripheral.writeHandleAsync(0x001a, Buffer.from([0x01, 0x00]), false);

    const c3 = characteristics[3];
    c3.notify(true);

    await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x00, 0x03, 0x00, 0x01, 0x23, 0x23, 0x00, 0x00, 0x00, 0x55, 0x00]), true);

    var n = 0;
    c3.on('data', async (data, x) => {
      this.platform.log.info('Notify data:', n, data, x);

      // Process response
      switch (data.readUInt8()) {
      case 0x60:
        const targetCoolTemp = this.rawHexToDec(data, 10);
        this.platform.log.info('targetCoolTemp:', targetCoolTemp);
        this.thermostatStates.CoolingThresholdTemperature = targetCoolTemp;
        this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.thermostatStates.CoolingThresholdTemperature);

        const targetHeatTemp = this.rawHexToDec(data, 12);
        this.platform.log.info('targetHeatTemp:', targetHeatTemp);
        this.thermostatStates.HeatingThresholdTemperature = targetHeatTemp;
        this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.thermostatStates.HeatingThresholdTemperature);
        break;

      case 0x40:
        const currentTemp = this.rawHexToDec(data, 7);
        this.platform.log.info('currentTemp:', currentTemp);
        this.thermostatStates.CurrentTemperature = currentTemp;
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.thermostatStates.CurrentTemperature);
        break;

      default:
        break;
      }

      this.thermostatStates.Active = this.platform.Characteristic.Active.ACTIVE;
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.thermostatStates.Active);

      this.thermostatStates.CurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.thermostatStates.CurrentHeaterCoolerState);

      this.thermostatStates.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, this.thermostatStates.TargetHeaterCoolerState);

      // Send another command
      switch (n) {
      case 0: 
        await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x01, 0x01, 0x00, 0x02, 0xBC, 0x32, 0x01, 0x00, 0x00, 0xFE, 0x00]), true);
        break;
      case 1: 
        await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x02, 0x03, 0x00, 0x02, 0xBC, 0x32, 0x01, 0x00, 0x00, 0x01, 0x01]), true);
        break;
      case 2: 
        await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x03, 0x01, 0x04, 0x02, 0xBC, 0x32, 0x01, 0x00, 0x00, 0x04, 0x01]), true);
        break;
      case 3: 
        await characteristics[2].writeAsync(Buffer.from([0x06, 0x00, 0x00, 0x05, 0x02, 0x00, 0x0D, 0x00]), true);
        break;
      case 6: 
        this.platform.log.info('disconnecting');
        // await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x06, 0x03, 0x01, 0x02, 0xBC, 0x32, 0x01, 0x00, 0x00, 0x06, 0x01]), true);
        await this.peripheral.disconnectAsync();
        break;
      default: 
        break;
      }

      n++;

      // todo: check heat/cool/auto thresholds, state, on/off, vane/swing, fan speed, isee, dry
    });
  }

  rawHexToDec(buffer: Buffer, offset: number) : number {
    const a = buffer.readUInt8(offset+1); // 01
    const b = buffer.readUInt8(offset); // 95
    return (((a & 0xf)*100)+((b >> 4)*10)+(b & 0xf))/10.0;
  }

 /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  handleActiveGet() {
    this.platform.log.debug('Triggered GET Active');

    return this.thermostatStates.Active;
  }

   /**
   * Handle requests to set the current value of the "Active" characteristic
   */
  handleActiveSet(value) {
    this.platform.log.debug('Triggered SET Active');

    this.thermostatStates.Active = value;
  }

 /**
  * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
  */
  handleCurrentHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');

    return this.thermostatStates.CurrentHeaterCoolerState;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');

    return this.thermostatStates.TargetHeaterCoolerState;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeaterCoolerStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);

    this.thermostatStates.TargetHeaterCoolerState = value;
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    return this.thermostatStates.CurrentTemperature;
  }


  /**
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  handleCoolingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    return this.thermostatStates.CoolingThresholdTemperature;
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  handleCoolingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET CoolingThresholdTemperature:', value);

    this.thermostatStates.CoolingThresholdTemperature = value;
  }

  /**
   * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
   */
  handleHeatingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET TargetTemperature');

    return this.thermostatStates.HeatingThresholdTemperature;
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  handleHeatingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET TargetTemperature:', value);

    this.thermostatStates.HeatingThresholdTemperature = value;
  }

}
