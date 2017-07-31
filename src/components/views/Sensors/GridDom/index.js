import React, { Component } from 'react';
import SensorContact from './SensorContact';
import gql from 'graphql-tag';
import { graphql, withApollo } from 'react-apollo';
import Immutable from 'immutable';
import * as THREE from 'three';

import './style.scss';

function distance3d(coord2, coord1) {
  const { x: x1, y: y1, z: z1 } = coord1;
  let { x: x2, y: y2, z: z2 } = coord2;
  return Math.sqrt((x2 -= x1) * x2 + (y2 -= y1) * y2 + (z2 -= z1) * z2);
}

// Implement The following:
// weaponsRange

const SENSORCONTACT_SUB = gql`
  subscription SensorContactsChanged($sensorId: ID) {
    sensorContactUpdate(sensorId: $sensorId) {
      id
      name
      size
      color
      icon
      picture
      speed
      velocity {
        x
        y
        z
      }
      location {
        x
        y
        z
      }
      destination {
        x
        y
        z
      }
      infrared
      cloaked
      destroyed
    }
  }
`;

class GridDom extends Component {
  state = {
    locations: {},
    movingContact: null,
    iconWidth: null
  };
  interval = 30;
  sensorContactsSubscription = null;
  componentWillReceiveProps(nextProps) {
    if (!this.sensorsSubscription && !nextProps.data.loading) {
      this.sensorsSubscription = nextProps.data.subscribeToMore({
        document: SENSORCONTACT_SUB,
        variables: { sensorId: this.props.sensor },
        updateQuery: (previousResult, { subscriptionData }) => {
          const returnResult = Immutable.Map(previousResult);
          return returnResult
            .mergeDeep({
              sensorContacts: subscriptionData.data.sensorContactUpdate
            })
            .toJS();
        }
      });
    }
    if (!nextProps.data.loading) {
      this.setState(({ locations: stateLocations }) => {
        const locations = {};
        nextProps.data.sensorContacts.forEach(c => {
          locations[c.id] = {
            location: stateLocations[c.id]
              ? stateLocations[c.id].location
              : c.location,
            speed: c.speed,
            destination: c.destination
          };
        });
        return { locations };
      });
    }
  }
  componentDidMount() {
    this.contactLoop();
  }
  componentWillUnmount() {
    clearTimeout(this.contactTimeout);
  }
  contactLoop = () => {
    this.contactTimeout = setTimeout(this.contactLoop, this.interval);
    if (!this.props.data.loading) {
      const { data: { sensorContacts: contacts } } = this.props;
      const locations = {};
      contacts.forEach(c => {
        const location = this.state.locations[c.id];
        let { speed, destination } = Object.assign({}, c);
        if (location) {
          speed = location.speed;
          destination = location.destination;
        }
        const moveResult = this.moveContact(c, location.location, speed);
        moveResult.destination = destination;
        locations[c.id] = moveResult;
      });
      this.setState({ locations });
    }
  };
  moveContact = ({ destination, velocity }, location, speed) => {
    const { movingContact } = this.state;
    if (speed > 100) {
      return {
        location: {
          x: location.x,
          y: location.y,
          z: location.z
        },
        speed: 0
      };
    } else if (speed > 0) {
      const locationVector = new THREE.Vector3(
        location.x,
        location.y,
        location.z
      );
      const destinationVector = new THREE.Vector3(
        destination.x,
        destination.y,
        destination.z
      );
      if (!movingContact) {
        velocity = destinationVector
          .sub(locationVector)
          .normalize()
          .multiplyScalar(speed);
      }
      // Update the location
      const newLocation = {
        x:
          location.x +
          Math.round(velocity.x / (10000 / this.interval) * 10000) / 10000,
        y:
          location.y +
          Math.round(velocity.y / (10000 / this.interval) * 10000) / 10000,
        z:
          location.z +
          Math.round(velocity.z / (10000 / this.interval) * 10000) / 10000
      };
      // Why not clean up the destination while we're at it?
      if (distance3d(destination, newLocation) < 0.005) {
        speed = 0;
      }
      return {
        location: newLocation,
        speed: speed
      };
    }
    return {
      location,
      speed
    };
  };
  _moveMouse = e => {
    const { dimensions, core } = this.props;
    const { movingContact, locations, iconWidth } = this.state;
    if (!movingContact) return;
    const { width: dimWidth, height: dimHeight } = dimensions;
    const padding = core ? 15 : 0;
    const width = Math.min(dimWidth, dimHeight) - padding;
    const destination = {
      x:
        (e.clientX - dimensions.left - padding - iconWidth / 2 - width / 2) /
        (width / 2),
      y:
        (e.clientY - dimensions.top - padding - iconWidth / 2 - width / 2) /
        (width / 2),
      z: 0
    };

    const obj = {};
    obj[movingContact] = locations[movingContact];
    obj[movingContact].destination = destination;

    this.setState({
      locations: Object.assign(locations, obj)
    });
  };
  _downMouse(e, id) {
    const self = this;
    const width = e.target.getBoundingClientRect().width;
    document.addEventListener('mousemove', this._moveMouse);
    document.addEventListener('mouseup', _upMouse);
    this.setState({
      movingContact: id,
      iconWidth: width
    });
    function _upMouse() {
      document.removeEventListener('mousemove', self._moveMouse);
      document.removeEventListener('mouseup', _upMouse);
      // Send the update to the server
      const speed = self.props.moveSpeed;
      const { movingContact, locations } = self.state;
      const { destination } = locations[movingContact];
      self.setState({
        movingContact: false,
        iconWidth: null
      });
      const distance = distance3d({ x: 0, y: 0, z: 0 }, destination);
      let mutation;
      if (distance > 1.08) {
        // Delete the contact
        mutation = gql`
          mutation DeleteContact($id: ID!, $contact: SensorContactInput!) {
            removeSensorContact(id: $id, contact: $contact)
          }
        `;
      } else {
        mutation = gql`
          mutation MoveSensorContact($id: ID!, $contact: SensorContactInput!) {
            moveSensorContact(id: $id, contact: $contact)
          }
        `;
      }
      const variables = {
        id: self.props.sensor,
        contact: {
          id: movingContact,
          speed: speed,
          destination: {
            x: destination.x,
            y: destination.y,
            z: destination.z
          }
        }
      };
      self.props.client.mutate({
        mutation,
        variables
      });
    }
  }
  render() {
    if (this.props.data.loading) return null;
    const {
      dimensions,
      data,
      core,
      movingContact,
      setSelectedContact,
      selectedContact,
      armyContacts,
      rings = 3,
      lines = 12,
      hoverContact
    } = this.props;
    const { locations } = this.state;
    const { sensorContacts: contacts } = data;
    const { width: dimWidth, height: dimHeight } = dimensions;
    const padding = core ? 15 : 0;
    const width = Math.min(dimWidth, dimHeight) - padding;
    const gridStyle = {
      width: `${width}px`,
      height: `${width}px`,
      borderWidth: core ? `${padding}px` : '4px'
    };
    return (
      <div id="sensorGrid" style={gridStyle}>
        <div className="grid">
          {Array(rings).fill(0).map((_, i, array) =>
            <div
              key={`ring-${i}`}
              className="ring"
              style={{
                width: `${(i + 1) / array.length * 100}%`,
                height: `${(i + 1) / array.length * 100}%`
              }}
            />
          )}
          {Array(lines).fill(0).map((_, i, array) =>
            <div
              key={`line-${i}`}
              className="line"
              style={{
                transform: `rotate(${(i + 0.5) / array.length * 360}deg)`
              }}
            />
          )}
          {contacts.map(contact =>
            <SensorContact
              key={contact.id}
              width={width}
              core={core}
              {...contact}
              mousedown={e => this._downMouse(e, contact.id)}
              location={locations[contact.id].location}
              destination={locations[contact.id].destination}
              mouseover={hoverContact}
            />
          )}
          {movingContact &&
            <div id="movingContact">
              <SensorContact width={width} {...movingContact} />{' '}
            </div>}
        </div>
      </div>
    );
  }
}

const CONTACTS_QUERY = gql`
  query Contacts($sensorsId: ID) {
    sensorContacts(sensorsId: $sensorsId) {
      id
      name
      size
      icon
      picture
      color
      speed
      velocity {
        x
        y
        z
      }
      location {
        x
        y
        z
      }
      destination {
        x
        y
        z
      }
      infrared
      cloaked
      destroyed
    }
  }
`;

export default graphql(CONTACTS_QUERY, {
  options: ({ sensor }) => ({ variables: { sensorsId: sensor } })
})(withApollo(GridDom));