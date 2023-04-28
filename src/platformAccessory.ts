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

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private thermostatStates = {
    CurrentTemperature: 0,
    TargetTemperature: 0,
    CurrentHeatingCoolingState: 0, // this.platform.Characteristic.CurrentHeatingCoolingState.OFF
    TargetHeatingCoolingState: 0, // this.platform.Characteristic.TargetHeatingCoolingState.OFF
    TemperatureDisplayUnits: 0,
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
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, peripheral.advertisement.localName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // register handlers for the Thermostat Characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));
  
   /**
    * Update characteristics values asynchronously.
    */

     setTimeout(async () => {
      await this.update();
    }, 250);

    setInterval(async () => {
      await this.update();
    }, 10000);
  }

  async update() {
    this.platform.log.debug('update()');

    var f = false
    if (this.peripheral.state != 'connected') {
      this.platform.log.info('connecting');
      await this.peripheral.connectAsync();
      f = true;
    }

    // read 13
    // read 15

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

    const c2 = characteristics[3];

    c2.notify(true);

    if (f) {
      // c2.subscribe();
      await characteristics[2].writeAsync(Buffer.from([0x0B, 0x00, 0x00, 0x03, 0x00, 0x01, 0x23, 0x23, 0x00, 0x00, 0x00, 0x55, 0x00]), true);
    }

    var n = 0;
    c2.on('data', async (data, x) => {
      this.platform.log.info('c2 data', n, data, x);

      if (data.readUInt8() == 0x60) {
        const a = data.readUInt8(13); // 01
        const b = data.readUInt8(12); // 95
        const c = (((a & 0xf)*100)+((b >> 4)*10)+(b & 0xf))/10.0;

        this.platform.log.info('found target temp', a&0xf, b>>4, b&0xf, c);
        this.thermostatStates.TargetTemperature = c;
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.thermostatStates.TargetTemperature);
      }
      if (data.readUInt8() == 0x40) {

        const a2 = data.readUInt8(8); // 01
        const b2 = data.readUInt8(7); // 95
        const c2 = (((a2 & 0xf)*100)+((b2 >> 4)*10)+(b2 & 0xf))/10.0;

        this.platform.log.info('found current temp', a2&0xf, b2>>4, b2&0xf, c2);
        this.thermostatStates.CurrentTemperature = c2;
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.thermostatStates.CurrentTemperature);

        this.thermostatStates.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.thermostatStates.CurrentHeatingCoolingState);

        this.thermostatStates.TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.thermostatStates.TargetHeatingCoolingState);
      }

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
        this.platform.log.info('bye');
        await this.peripheral.disconnectAsync();
        break;
      default: 
        break;
      }

      n++;

      // todo: state, on/off, vane/swing, fan speed, isee, Fahrenheit, dry, display units
    });

    //await this.peripheral.disconnectAsync();
  }

 /**
  * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
  */
  handleCurrentHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeatingCoolingState');

    return this.thermostatStates.CurrentHeatingCoolingState;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');

    return this.thermostatStates.TargetHeatingCoolingState;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeatingCoolingState:', value);

    this.thermostatStates.TargetHeatingCoolingState = value;
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    return this.thermostatStates.CurrentTemperature;
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet() {
    this.platform.log.debug('Triggered GET TargetTemperature');

    return this.thermostatStates.TargetTemperature;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  handleTargetTemperatureSet(value) {
    this.platform.log.debug('Triggered SET TargetTemperature:', value);

    this.thermostatStates.TargetTemperature = value;
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    this.platform.log.debug('Triggered GET TemperatureDisplayUnits');

    // set this to a valid value for TemperatureDisplayUnits
    return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value) {
    this.platform.log.debug('Triggered SET TemperatureDisplayUnits:', value);
  }

}
